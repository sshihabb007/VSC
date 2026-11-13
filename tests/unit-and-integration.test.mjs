import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  SPEED_LIMITS,
  clampSpeed,
  roundSpeed,
  formatSpeed,
  displayKeyFromCode,
} from '../src/utils/constants.js';
import { compileSitePattern, validateSitePattern, matchSiteRule } from '../src/utils/site-pattern.js';
import { isBlacklisted } from '../src/utils/blacklist.js';
import { DEFAULT_CONTROLLER_CSS, preprocessDomainCSS } from '../src/styles/controller-css-defaults.js';
import {
  DEFAULT_POSITION,
  BUILTIN_PLATFORM_PRESETS,
  computeAnchorCoordinates,
  resolveSitePosition,
  nudgePosition,
  normalizeSitePatternInput,
  ensureBuiltinPlatformPresets,
} from '../src/core/position.js';
import { SpeedArbiter } from '../src/core/arbiter.js';
import { ControllerVisibility } from '../src/core/controller-visibility.js';
import {
  IntentClassifier,
  CLASSIFIER_VERDICTS,
  isNativeSpeedShortcutKey,
} from '../src/core/intent-classifier.js';
import { SpeedArbitration } from '../src/core/speed-arbitration.js';
import { VideoSpeedConfig } from '../src/core/settings.js';
import { ActionHandler } from '../src/core/action-handler.js';
import { stateManager } from '../src/core/state-manager.js';
import { ShadowDOMManager } from '../src/ui/shadow-dom.js';
import { DragHandler } from '../src/ui/drag-handler.js';
import { VideoMutationObserver } from '../src/observers/mutation-observer.js';

function createMockClassList() {
  const set = new Set();
  return {
    add: (...cls) => cls.forEach((c) => set.add(c)),
    remove: (...cls) => cls.forEach((c) => set.delete(c)),
    contains: (c) => set.has(c),
    toggle: (c, force) => {
      if (force === undefined) {
        if (set.has(c)) {
          set.delete(c);
          return false;
        }
        set.add(c);
        return true;
      }
      if (force) set.add(c);
      else set.delete(c);
      return force;
    },
  };
}

function createMockElement(tagName = 'DIV') {
  const attrs = new Map();
  const styles = new Map();
  const listeners = new Map();
  const children = [];
  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    nodeName: tagName.toUpperCase(),
    id: '',
    className: '',
    classList: createMockClassList(),
    textContent: '',
    isConnected: true,
    children,
    parentNode: null,
    parentElement: null,
    shadowRoot: null,
    dataset: {},
    style: {
      setProperty: (k, v) => styles.set(k, String(v)),
      getPropertyValue: (k) => styles.get(k) || '',
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
    appendChild: (child) => {
      child.parentNode = el;
      child.parentElement = el;
      children.push(child);
      return child;
    },
    contains: (other) => {
      let cur = other;
      while (cur) {
        if (cur === el) return true;
        cur = cur.parentNode;
      }
      return false;
    },
    getRootNode: () => el._root || el.ownerDocument || el,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: (ev) => {
      ev.target ||= el;
      ev.currentTarget = el;
      ev.stopImmediatePropagation ||= () => {
        ev._stoppedImmediate = true;
      };
      for (const fn of [...(listeners.get(ev.type) || [])]) {
        if (ev._stoppedImmediate) break;
        fn(ev);
      }
      return true;
    },
    querySelector: (sel) => {
      const visit = (root) => {
        for (const c of root.children || []) {
          if (sel.startsWith('#') && c.id === sel.slice(1)) return c;
          if (sel.startsWith('.') && c.className.split(/\s+/).includes(sel.slice(1))) return c;
          if (c.tagName === sel.toUpperCase()) return c;
          const nested = visit(c);
          if (nested) return nested;
        }
        return null;
      };
      return visit(el);
    },
    querySelectorAll: (sel) => {
      const out = [];
      const visit = (root) => {
        for (const c of root.children || []) {
          if (c.tagName === sel.toUpperCase()) out.push(c);
          visit(c);
        }
      };
      visit(el);
      return out;
    },
    attachShadow: () => {
      const shadow = createMockElement('#SHADOW');
      shadow.host = el;
      shadow.adoptedStyleSheets = [];
      shadow.getRootNode = () => shadow;
      el.shadowRoot = shadow;
      return shadow;
    },
    getBoundingClientRect: () => ({ top: 20, left: 30, right: 130, bottom: 50, width: 100, height: 30 }),
  };
  return el;
}

function withMockDOM(fn) {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevElem = globalThis.Element;
  const prevCSS = globalThis.CSSStyleSheet;
  const prevRAF = globalThis.requestAnimationFrame;
  const prevCAF = globalThis.cancelAnimationFrame;

  const mockDoc = {
    nodeType: 9,
    createElement: (tag) => {
      const el = createMockElement(tag);
      el.ownerDocument = mockDoc;
      return el;
    },
    documentElement: { clientWidth: 1280, clientHeight: 720 },
  };

  class MockCSSStyleSheet {
    replaceSync(text) {
      this.cssText = text;
    }
  }

  let nextRaf = 1;
  const rafQueue = new Map();

  globalThis.document = mockDoc;
  globalThis.window = { innerWidth: 1280, innerHeight: 720 };
  globalThis.Element = Object;
  globalThis.CSSStyleSheet = MockCSSStyleSheet;
  globalThis.requestAnimationFrame = (cb) => {
    const id = nextRaf++;
    rafQueue.set(id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafQueue.delete(id);
  };

  const flushRaf = () => {
    const items = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, cb] of items) cb(performance.now());
  };

  try {
    return fn({ mockDoc, flushRaf });
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.Element = prevElem;
    globalThis.CSSStyleSheet = prevCSS;
    globalThis.requestAnimationFrame = prevRAF;
    globalThis.cancelAnimationFrame = prevCAF;
  }
}

test('constants helpers clamp, round, format, and display key codes cleanly', () => {
  assert.equal(clampSpeed(0.01), SPEED_LIMITS.MIN);
  assert.equal(clampSpeed(42), SPEED_LIMITS.MAX);
  assert.equal(clampSpeed(1.5), 1.5);
  assert.equal(roundSpeed(1.0 + 0.1 + 0.2), 1.3);
  assert.equal(roundSpeed(1.005), 1.01);
  assert.equal(formatSpeed(2), '2.00');

  assert.equal(displayKeyFromCode('KeyD'), 'd');
  assert.equal(displayKeyFromCode('Digit7'), '7');
  assert.equal(displayKeyFromCode('Numpad3'), 'Num 3');
  assert.equal(displayKeyFromCode('Minus'), '-');
  assert.equal(displayKeyFromCode('F19'), 'F19');
  assert.equal(displayKeyFromCode('Backquote'), '`');
});

test('site-pattern & blacklist matching stays stateless and handles domain vs regex rules', () => {
  const yt = compileSitePattern('youtube.com');
  assert.ok(yt.test('https://www.youtube.com/watch?v=1'));
  assert.ok(yt.test('https://m.youtube.com/watch?v=1'));
  assert.equal(yt.test('https://notyoutube.com/watch?v=1'), false);

  // Stateful /g and /y flags must be stripped so alternating calls stay deterministic
  const statefulRegex = compileSitePattern('/twitch\\.tv\\/videos/gi');
  assert.equal(statefulRegex.test('https://www.twitch.tv/videos/123'), true);
  assert.equal(statefulRegex.test('https://www.twitch.tv/videos/456'), true);
  assert.equal(statefulRegex.test('https://www.twitch.tv/videos/789'), true);

  const invalid = validateSitePattern('/[unclosed/');
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /Invalid pattern/);

  assert.equal(validateSitePattern('   ').valid, false);
  assert.equal(validateSitePattern('netflix.com').valid, true);

  const rule = matchSiteRule(
    [
      { pattern: 'imgur.com', enabled: false, speed: null },
      { pattern: 'youtube.com', enabled: true, speed: 1.75 },
    ],
    'https://www.youtube.com/watch?v=abc'
  );
  assert.deepEqual(rule, { pattern: 'youtube.com', enabled: true, speed: 1.75 });

  assert.equal(isBlacklisted('imgur.com\n/example\\.org/i', 'https://i.imgur.com/a.mp4'), true);
  assert.equal(isBlacklisted('imgur.com\n/example\\.org/i', 'https://vimeo.com/123'), false);
});

test('preprocessDomainCSS scopes per-domain rules accurately', () => {
  const ytCSS = preprocessDomainCSS(DEFAULT_CONTROLLER_CSS, 'www.youtube.com');
  assert.match(ytCSS, /\.ytp-autohide/);
  assert.doesNotMatch(ytCSS, /youtube-nocookie\.com/);
  assert.match(ytCSS, /\.Shared-Video-player/);

  const nocookieCSS = preprocessDomainCSS(DEFAULT_CONTROLLER_CSS, 'www.youtube-nocookie.com');
  assert.match(nocookieCSS, /\.ytp-autohide/);
  assert.doesNotMatch(nocookieCSS, /"youtube\.com"/);

  const genericCSS = preprocessDomainCSS(DEFAULT_CONTROLLER_CSS, 'example.com');
  assert.doesNotMatch(genericCSS, /--vsc-domain/);
  assert.doesNotMatch(genericCSS, /\.ytp-autohide/);
  assert.match(genericCSS, /\.Shared-Video-player/);
});

test('SpeedArbiter FSM enforces hold, 4-fight surrender, rearm, and temporary override lifecycle', () => {
  let state = SpeedArbiter.makeState(SpeedArbiter.MODES.NO_OPINION, null, 0);

  // USER_SET transitions to HOLDING
  let step = SpeedArbiter.step(state, { type: SpeedArbiter.EVENTS.USER_SET, speed: 1.5 });
  state = step.state;
  assert.equal(state.mode, SpeedArbiter.MODES.HOLDING);
  assert.equal(state.desired, 1.5);

  // 4 fights stay in HOLDING (fightCount 1..4) and emit WRITE
  for (let i = 1; i <= 4; i++) {
    step = SpeedArbiter.step(state, {
      type: SpeedArbiter.EVENTS.EXT_RATE,
      rateClass: SpeedArbiter.RATE_CLASSES.AUTONOMOUS,
      speed: 1.0,
      quiet: true,
    });
    state = step.state;
    assert.equal(state.mode, SpeedArbiter.MODES.HOLDING);
    assert.equal(state.fightCount, i);
    assert.deepEqual(step.effects, [{ type: SpeedArbiter.EFFECTS.WRITE, speed: 1.5 }]);
  }

  // 5th fight (fightCount === maxFight === 4) surrenders to REARMABLE (rearmBudget = 1) and syncs UI to 1.0
  step = SpeedArbiter.step(state, {
    type: SpeedArbiter.EVENTS.EXT_RATE,
    rateClass: SpeedArbiter.RATE_CLASSES.AUTONOMOUS,
    speed: 1.0,
    quiet: true,
  });
  state = step.state;
  assert.equal(state.mode, SpeedArbiter.MODES.REARMABLE);
  assert.equal(state.rearmBudget, 0);
  assert.deepEqual(step.effects, [{ type: SpeedArbiter.EFFECTS.SYNC_UI, speed: 1.0 }]);

  // LIFECYCLE event on REARMABLE rearms ONCE to HOLDING (consuming the rearm while budget stays 0)
  step = SpeedArbiter.step(state, { type: SpeedArbiter.EVENTS.LIFECYCLE });
  state = step.state;
  assert.equal(state.mode, SpeedArbiter.MODES.HOLDING);
  assert.equal(state.rearmBudget, 0);
  assert.deepEqual(step.effects, [{ type: SpeedArbiter.EFFECTS.WRITE, speed: 1.5 }]);

  // 5 more autonomous fights with rearmBudget = 0 reaches SUPPRESSED permanently in this epoch
  for (let i = 0; i < 5; i++) {
    step = SpeedArbiter.step(state, {
      type: SpeedArbiter.EVENTS.EXT_RATE,
      rateClass: SpeedArbiter.RATE_CLASSES.AUTONOMOUS,
      speed: 1.0,
      quiet: true,
    });
    state = step.state;
  }
  assert.equal(state.mode, SpeedArbiter.MODES.SUPPRESSED);

  // Temporary override overlay restores desired speed when ended
  const holdState = SpeedArbiter.makeState(SpeedArbiter.MODES.HOLDING, 1.75, 0);
  step = SpeedArbiter.step(holdState, {
    type: SpeedArbiter.EVENTS.TEMPORARY_OVERRIDE_START,
    speed: 2.0,
  });
  assert.equal(step.state.temporaryOverride, true);
  assert.deepEqual(step.effects, [{ type: SpeedArbiter.EFFECTS.SYNC_UI, speed: 2.0 }]);

  step = SpeedArbiter.step(step.state, {
    type: SpeedArbiter.EVENTS.TEMPORARY_OVERRIDE_END,
    speed: 1.0,
  });
  assert.equal(step.state.temporaryOverride, false);
  assert.deepEqual(step.effects, [
    { type: SpeedArbiter.EFFECTS.WRITE, speed: 1.75 },
    { type: SpeedArbiter.EFFECTS.SYNC_UI, speed: 1.75 },
  ]);
});

test('ControllerVisibility FSM resolves overrides and automatic signals cleanly', () => {
  let vis = ControllerVisibility.createState({ startHidden: false, noSource: false });
  assert.equal(ControllerVisibility.isVisible(vis), true);

  const next = ControllerVisibility.nextOverride(vis.override, ControllerVisibility.isVisible(vis));
  assert.equal(next, ControllerVisibility.OVERRIDES.HIDE);
  vis = ControllerVisibility.step(vis, { type: ControllerVisibility.EVENTS.TOGGLE });
  assert.equal(vis.override, ControllerVisibility.OVERRIDES.HIDE);
  assert.equal(ControllerVisibility.isVisible(vis), false);
  assert.equal(ControllerVisibility.allowsFlash(vis), false);

  vis = ControllerVisibility.step(vis, { type: ControllerVisibility.EVENTS.TOGGLE });
  assert.equal(vis.override, ControllerVisibility.OVERRIDES.SHOW);
  assert.equal(ControllerVisibility.isVisible(vis), true);
  assert.equal(ControllerVisibility.allowsFlash(vis), true);

  // Automatic site autohide hides AUTO state, whereas explicit SHOW outranks it
  let autoVis = ControllerVisibility.createState();
  autoVis = ControllerVisibility.step(autoVis, {
    type: ControllerVisibility.EVENTS.SET_SITE_AUTOHIDE,
    value: true,
  });
  assert.equal(ControllerVisibility.isVisible(autoVis), false);

  autoVis = ControllerVisibility.step(autoVis, { type: ControllerVisibility.EVENTS.TOGGLE });
  assert.equal(autoVis.override, ControllerVisibility.OVERRIDES.SHOW);
  assert.equal(ControllerVisibility.isVisible(autoVis), true);
});

test('IntentClassifier distinguishes user intent, 1.0x seek side-effect demotion, and fixes clearTemporaryHoldsForMedia', () => {
  const mediaA = { id: 'a', seeking: false };
  const mediaB = { id: 'b', seeking: false };
  const classifier = new IntentClassifier({ pointerHoldArms: true, spacebarArms: true });

  // Native < and > detection
  assert.equal(isNativeSpeedShortcutKey({ key: '>', shiftKey: true, keyCode: 190 }), true);
  assert.equal(isNativeSpeedShortcutKey({ key: 'a', shiftKey: false, keyCode: 65 }), false);

  // Self & init noise
  assert.equal(
    classifier.classify({ media: mediaA, rate: 1.5, timeStamp: 1000, readyState: 2, detail: { origin: 'videoSpeed' } }),
    CLASSIFIER_VERDICTS.SELF
  );
  assert.equal(
    classifier.classify({ media: mediaA, rate: 1.5, timeStamp: 1000, readyState: 0 }),
    CLASSIFIER_VERDICTS.INIT_NOISE
  );

  // Rapid 2-click sequence -> USER_INTENT on non-1.0x rate
  classifier.observeClick({ timeStamp: 1000 }, mediaA);
  classifier.observeClick({ timeStamp: 1200 }, mediaA);
  assert.equal(
    classifier.classify({ media: mediaA, rate: 1.5, timeStamp: 1300, readyState: 3 }),
    CLASSIFIER_VERDICTS.USER_INTENT
  );

  // 1.0x rate change right after seek on same click sequence demotes to AUTONOMOUS (not user intent)
  classifier.observeMediaInit(mediaA, 900);
  assert.equal(
    classifier.classify({ media: mediaA, rate: 1.0, timeStamp: 1300, readyState: 3 }),
    CLASSIFIER_VERDICTS.AUTONOMOUS
  );

  // Pointer 2.0x hold arms only for targeted media and clearTemporaryHoldsForMedia cleanly clears pointerOwners!
  classifier.observePointerDown({ pointerId: 7, timeStamp: 5000 }, mediaA);
  assert.equal(classifier.hasActiveTemporaryHoldFor(mediaA, 5050), true);
  assert.equal(classifier.hasActiveTemporaryHoldFor(mediaB, 5050), false);
  assert.equal(
    classifier.classify({ media: mediaA, rate: 2.0, timeStamp: 5050, readyState: 3 }),
    CLASSIFIER_VERDICTS.TEMPORARY_OVERRIDE
  );

  classifier.clearTemporaryHoldsForMedia(mediaA);
  assert.equal(classifier.pointerOwners.has(7), false);
  assert.equal(classifier.hasActiveTemporaryHoldFor(mediaA, 5060), false);
});

test('SpeedArbitration handles echoes, reactive suppression, and multi-video epoch batching', () => {
  const media1 = { isConnected: true, playbackRate: 1.0, readyState: 4, vsc: {} };
  const media2 = { isConnected: true, playbackRate: 1.0, readyState: 4, vsc: {} };
  const config = new VideoSpeedConfig();
  const arbitration = new SpeedArbitration(config, null);

  const handler = new ActionHandler(config, { arbitration });
  const batch = handler.createAuthorityBatch();
  assert.deepEqual(batch.claimWriteOptions(), { startsAuthorityEpoch: true });
  assert.deepEqual(batch.claimWriteOptions(), { startsAuthorityEpoch: false });

  arbitration.noteUserSet(media1, 1.5, { startsAuthorityEpoch: true });
  assert.equal(arbitration.authorityEpoch, 1);
  assert.equal(config.settings.lastSpeed, 1.5);
  arbitration.noteUserSet(media2, 1.0, { startsAuthorityEpoch: false });
  assert.equal(arbitration.authorityEpoch, 1);
  // Secondary non-epoch batch write must not clobber primary authority speed
  assert.equal(config.settings.lastSpeed, 1.5);

  // Matching echo is consumed without triggering fight escalation
  arbitration.noteWrite(media1, 1.5);
  const echo = arbitration.consumeEcho(media1, 1.5);
  assert.ok(echo);
  assert.equal(echo.rate, 1.5);
  assert.equal(arbitration.consumeEcho(media1, 1.5), null);
});

test('VideoSpeedConfig O(1) indexed matching, chord priority, Unidentified fallback, and migration', async () => {
  const cfg = new VideoSpeedConfig();

  // Verify default shortcuts & values match configured defaults
  const actualDefaults = cfg.settings.keyBindings.map((b) => [b.action, b.displayKey, b.value]);
  assert.deepEqual(actualDefaults, [
    ['slower', 'x', 0.1],
    ['faster', 'c', 0.1],
    ['rewind', 's', 5],
    ['advance', 'd', 5],
    ['reset', 'z', 1.0],
    ['fast', 'g', 1.6],
    ['display', 'v', 0],
    ['mark', 'm', 0],
    ['jump', 'j', 0],
  ]);

  // Default simple bindings (Ctrl/Alt/Meta reject simple bindings; Shift still falls back unless chord overrides)
  const faster = cfg.matchKeyboardEvent({ code: 'KeyC', key: 'c', keyCode: 67 });
  assert.equal(faster?.action, 'faster');

  assert.equal(cfg.matchKeyboardEvent({ code: 'KeyC', key: 'c', keyCode: 67, ctrlKey: true }), undefined);
  assert.equal(cfg.matchKeyboardEvent({ code: 'KeyC', key: 'C', keyCode: 67, shiftKey: true })?.action, 'faster');

  // Chorded binding evaluated before unchorded same-code binding
  cfg.settings.keyBindings.push({
    action: 'display',
    code: 'KeyC',
    key: 67,
    value: 0,
    modifiers: { shift: true },
  });
  cfg.rebuildIndexes();

  assert.equal(cfg.matchKeyboardEvent({ code: 'KeyC', key: 'C', keyCode: 67, shiftKey: true })?.action, 'display');
  assert.equal(cfg.matchKeyboardEvent({ code: 'KeyC', key: 'c', keyCode: 67, shiftKey: false })?.action, 'faster');

  // Unidentified code fallback + F13-F24 lookup
  cfg.settings.keyBindings.push({ action: 'mark', code: 'F19', key: 130, keyCode: 130, value: 0 });
  cfg.rebuildIndexes();
  assert.equal(cfg.matchKeyboardEvent({ code: '', key: 'F19', keyCode: 130 })?.action, 'mark');
  assert.equal(
    cfg.matchKeyboardEvent({ code: 'Unidentified', key: 'c', keyCode: 67 })?.action,
    'faster'
  );

  // Verify blacklist -> siteRules migration logic via normalize + evaluateSiteRule
  cfg.settings.siteRules = [
    { pattern: 'coursera.org', enabled: true, speed: 2.25 },
    { pattern: 'imgur.com', enabled: false, speed: null },
  ];
  const matched = cfg.evaluateSiteRule('https://www.coursera.org/learn/ml');
  assert.equal(matched?.enabled, true);
  assert.equal(cfg.settings.siteDefaultSpeed, 2.25);

  const blocked = cfg.evaluateSiteRule('https://imgur.com/gallery/xyz');
  assert.equal(blocked?.enabled, false);
  assert.equal(cfg.settings.siteDefaultSpeed, null);
});

test('ActionHandler math, boundary snap at 1.0x, reset/fast toggle, mark/jump, and single-controller target isolation', () => {
  const cfg = new VideoSpeedConfig();
  const written = [];
  const synced = [];
  const handler = new ActionHandler(cfg, null);
  handler.writeRate = (video, speed) => {
    video.playbackRate = speed;
    written.push([video.id, speed]);
  };
  handler.syncIndicator = (video, speed) => {
    synced.push([video.id, speed]);
  };
  handler.flashController = () => {};

  const v1 = { id: 'v1', tagName: 'VIDEO', isConnected: true, playbackRate: 0.95, currentTime: 42, vsc: { div: createMockElement('vsc-controller') } };
  const v2 = { id: 'v2', tagName: 'VIDEO', isConnected: true, playbackRate: 1.0, currentTime: 10, vsc: { div: createMockElement('vsc-controller') } };
  stateManager.controllers.clear();
  stateManager.controllers.set('c1', { element: v1, wrapper: v1.vsc.div });
  stateManager.controllers.set('c2', { element: v2, wrapper: v2.vsc.div });

  // Boundary snap from 0.95 + 0.1 -> snaps to 1.0 (not 1.05)
  handler.adjustSpeed(v1, 0.1, { relative: true });
  assert.equal(v1.playbackRate, 1.0);

  // Reset -> sets 1.0 or toggles speedBeforeReset / crossTarget
  v1.playbackRate = 1.6;
  handler.executeAction('reset', 1.0, v1);
  assert.equal(v1.playbackRate, 1.0);
  handler.executeAction('reset', 1.0, v1);
  assert.equal(v1.playbackRate, 1.6);

  // Mark & jump round-trip
  handler.executeAction('mark', null, v1);
  assert.equal(v1.vsc.mark, 42);
  v1.currentTime = 120;
  handler.executeAction('jump', null, v1);
  assert.equal(v1.currentTime, 42);
  handler.executeAction('jump', null, v1);
  assert.equal(v1.currentTime, 120);

  // Controller isolation check: event targeted directly at c1 must NOT affect v2
  written.length = 0;
  handler.runAction('faster', 0.2, { target: v1.vsc.div });
  assert.deepEqual(written, [['v1', 1.8]]);

  stateManager.controllers.clear();
});

test('ShadowDOMManager reuses one shared stylesheet and DragHandler coalesces GPU transform offsets', () => {
  withMockDOM(({ mockDoc, flushRaf }) => {
    const host1 = mockDoc.createElement('vsc-controller');
    const host2 = mockDoc.createElement('vsc-controller');
    const shadow1 = ShadowDOMManager.createShadowDOM(host1, { speed: '1.25', opacity: 0.5, buttonSize: 16 });
    const shadow2 = ShadowDOMManager.createShadowDOM(host2, { speed: '1.50', opacity: 0.8, buttonSize: 14 });

    assert.equal(shadow1.adoptedStyleSheets.length, 1);
    assert.equal(shadow1.adoptedStyleSheets[0], shadow2.adoptedStyleSheets[0]);
    assert.equal(ShadowDOMManager.getSpeedIndicator(shadow1).textContent, '1.25');

    ShadowDOMManager.updateAppearance(shadow1, { opacity: 0.9, buttonSize: 18 });
    const ctrl = ShadowDOMManager.getController(shadow1);
    assert.equal(ctrl.style.getPropertyValue('--vsc-opacity'), '0.9');
    assert.equal(ctrl.style.getPropertyValue('--vsc-font-size'), '18px');

    const video = { classList: createMockClassList(), vsc: { div: host1 } };
    const draggable = ShadowDOMManager.getSpeedIndicator(shadow1);
    DragHandler.handleDrag(video, {
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      currentTarget: draggable,
      target: draggable,
    });

    draggable.dispatchEvent({ type: 'pointermove', clientX: 150, clientY: 120 });
    flushRaf();
    assert.equal(ctrl.style.getPropertyValue('--vsc-tx'), '50px');
    assert.equal(ctrl.style.getPropertyValue('--vsc-ty'), '20px');

    // Clamp extreme negative delta within viewport padding (-30 + 4 = -26px)
    draggable.dispatchEvent({ type: 'pointermove', clientX: -500, clientY: -500 });
    flushRaf();
    assert.equal(ctrl.style.getPropertyValue('--vsc-tx'), '-26px');
    assert.equal(ctrl.style.getPropertyValue('--vsc-ty'), '-16px');

    draggable.dispatchEvent({ type: 'pointerup', clientX: -500, clientY: -500 });
    assert.equal(ctrl.classList.contains('dragging'), false);
    assert.equal(video.classList.contains('vcs-dragging'), false);
  });
});

test('VideoMutationObserver disconnects all tracked shadow observers cleanly on stop()', () => {
  const disconnected = [];
  const origObs = globalThis.MutationObserver;
  const origDoc = globalThis.document;

  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.targets = [];
    }
    observe(target) {
      this.targets.push(target);
    }
    disconnect() {
      disconnected.push(this.targets);
    }
  }

  globalThis.MutationObserver = FakeMutationObserver;
  const rootEl = createMockElement('div');
  const shadowHost = createMockElement('custom-player');
  const shadow = shadowHost.attachShadow({ mode: 'open' });
  rootEl.appendChild(shadowHost);

  const walkList = [shadowHost];
  let walkIdx = 0;
  const mockDoc = {
    body: rootEl,
    createTreeWalker: () => ({
      nextNode: () => walkList[walkIdx++] || null,
    }),
  };
  globalThis.document = mockDoc;

  try {
    const obs = new VideoMutationObserver(new VideoSpeedConfig(), () => {}, () => {}, null);
    obs.start(mockDoc);
    assert.equal(obs.shadowObservers.has(shadow), true);

    // Self-mutations originating from VSC-CONTROLLER must be ignored
    obs.processMutations([{ target: { tagName: 'VSC-CONTROLLER' }, type: 'childList', addedNodes: [], removedNodes: [] }]);
    assert.equal(obs.pendingNodes.size, 0);

    obs.stop();
    assert.equal(obs.shadowObservers.size, 0);
    assert.equal(disconnected.length, 2); // body observer + shadow observer
  } finally {
    globalThis.MutationObserver = origObs;
    globalThis.document = origDoc;
  }
});

test('computeAnchorCoordinates maps all 8 corners/edges, offsets, and wrapper deltas', () => {
  const videoRect = { left: 120, top: 60, width: 640, height: 360 };
  const wrapperRect = { left: 100, top: 50, width: 0, height: 0 };

  assert.deepEqual(
    computeAnchorCoordinates(videoRect, wrapperRect, { anchor: 'top-left', offsetX: 0, offsetY: 0 }, 12),
    { anchorX: '32px', anchorY: '22px', alignX: '0%', alignY: '0%' }
  );
  assert.deepEqual(
    computeAnchorCoordinates(videoRect, wrapperRect, { anchor: 'top', offsetX: 5, offsetY: -4 }, 12),
    { anchorX: '345px', anchorY: '18px', alignX: '-50%', alignY: '0%' }
  );
  assert.deepEqual(
    computeAnchorCoordinates(videoRect, wrapperRect, { anchor: 'top-right', offsetX: -10, offsetY: 8 }, 12),
    { anchorX: '638px', anchorY: '30px', alignX: '-100%', alignY: '0%' }
  );
  assert.deepEqual(
    computeAnchorCoordinates(videoRect, wrapperRect, { anchor: 'left', offsetX: 0, offsetY: 0 }, 12),
    { anchorX: '32px', anchorY: '190px', alignX: '0%', alignY: '-50%' }
  );
  assert.deepEqual(
    computeAnchorCoordinates(videoRect, wrapperRect, { anchor: 'right', offsetX: 0, offsetY: 0 }, 12),
    { anchorX: '648px', anchorY: '190px', alignX: '-100%', alignY: '-50%' }
  );
  assert.deepEqual(
    computeAnchorCoordinates(videoRect, wrapperRect, { anchor: 'bottom-left', offsetX: 0, offsetY: 0 }, 12),
    { anchorX: '32px', anchorY: '358px', alignX: '0%', alignY: '-100%' }
  );
  assert.deepEqual(
    computeAnchorCoordinates(videoRect, wrapperRect, { anchor: 'bottom', offsetX: 0, offsetY: 0 }, 12),
    { anchorX: '340px', anchorY: '358px', alignX: '-50%', alignY: '-100%' }
  );
  assert.deepEqual(
    computeAnchorCoordinates(videoRect, wrapperRect, { anchor: 'bottom-right', offsetX: -15, offsetY: -20 }, 12),
    { anchorX: '633px', anchorY: '338px', alignX: '-100%', alignY: '-100%' }
  );

  // Collapsed/hidden video returns null rather than resetting coordinates to 0,0
  assert.equal(computeAnchorCoordinates({ left: 0, top: 0, width: 0, height: 0 }, wrapperRect, DEFAULT_POSITION), null);
});

test('resolveSitePosition isolates per-platform rules and nudges safely', () => {
  const sitePositions = ensureBuiltinPlatformPresets([
    { id: 'youtube', label: 'YouTube', pattern: 'youtube.com', anchor: 'top-right', offsetX: -10, offsetY: 12, builtin: true },
    { id: 'facebook', label: 'Facebook', pattern: 'facebook.com', anchor: 'bottom-left', offsetX: 0, offsetY: -30, builtin: true },
    { id: 'instagram', label: 'Instagram', pattern: 'instagram.com', anchor: 'bottom-right', offsetX: 0, offsetY: 0, builtin: true },
  ]);
  const fallback = { anchor: 'left', offsetX: 4, offsetY: 0 };

  assert.deepEqual(resolveSitePosition(sitePositions, fallback, 'https://www.youtube.com/watch?v=123'), {
    anchor: 'top-right',
    offsetX: -10,
    offsetY: 12,
  });
  assert.deepEqual(resolveSitePosition(sitePositions, fallback, 'https://www.facebook.com/reel/99'), {
    anchor: 'bottom-left',
    offsetX: 0,
    offsetY: -30,
  });
  assert.deepEqual(resolveSitePosition(sitePositions, fallback, 'https://www.instagram.com/p/xyz/'), {
    anchor: 'bottom-right',
    offsetX: 0,
    offsetY: 0,
  });

  // X (Twitter) builtin preset restored via ensureBuiltinPlatformPresets and avoids query false positives
  assert.equal(BUILTIN_PLATFORM_PRESETS.some((p) => p.id === 'x'), true);
  assert.deepEqual(resolveSitePosition(sitePositions, fallback, 'https://x.com/user/status/1'), {
    anchor: 'top-left',
    offsetX: 0,
    offsetY: 0,
  });
  assert.deepEqual(resolveSitePosition(sitePositions, fallback, 'https://twitter.com/home'), {
    anchor: 'top-left',
    offsetX: 0,
    offsetY: 0,
  });
  assert.deepEqual(resolveSitePosition(sitePositions, fallback, 'https://example.com/?next=x.com'), fallback);

  let nudged = nudgePosition({ anchor: 'bottom-right', offsetX: 0, offsetY: 0 }, 'up', 10);
  nudged = nudgePosition(nudged, 'left', 15);
  assert.deepEqual(nudged, { anchor: 'bottom-right', offsetX: -15, offsetY: -10 });

  assert.equal(normalizeSitePatternInput('https://www.Vimeo.com/12345'), 'vimeo.com');
  assert.equal(normalizeSitePatternInput('/\\.edu$/i'), '/\\.edu$/i');
});

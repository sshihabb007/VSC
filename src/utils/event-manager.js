import { LOG_LEVELS } from './constants.js';
import { inIframe } from './dom-utils.js';
import { logger } from './logger.js';
import { SpeedArbitration } from '../core/speed-arbitration.js';
import { CLASSIFIER_VERDICTS } from '../core/intent-classifier.js';
import { siteHandlerManager } from '../site-handlers/index.js';
import { stateManager } from '../core/state-manager.js';

const POINTER_MOVE_THROTTLE_MS = 100;

export class EventManager {
  constructor(config, actionHandler) {
    this.config = config;
    this.actionHandler = actionHandler;
    this.abortController = new AbortController();

    this.lastKeyCode = -1;
    this.lastCode = '';
    this.lastKey = '';
    this.lastTimeStamp = -1;
    this.lastType = '';
    this.lastMoveSample = 0;

    this.arbitration = new SpeedArbitration(config, this, {
      classifierRules: siteHandlerManager.getClassifierRules(),
    });
  }

  static modifiersMatch(mod, ctrl, alt, meta, shift) {
    return (
      Boolean(mod.ctrl) === ctrl &&
      Boolean(mod.alt) === alt &&
      Boolean(mod.meta) === meta &&
      Boolean(mod.shift) === shift
    );
  }

  setupEventListeners(doc) {
    this.setupKeyboardShortcuts(doc);
    this.setupRateChangeListener(doc);
    this.setupUserGestureListener(doc);
  }

  setupKeyboardShortcuts(doc) {
    const docs = [doc];
    try {
      if (inIframe()) {
        docs.push(window.top.document);
      }
    } catch {
      // Cross-origin iframe
    }

    const { signal } = this.abortController;
    for (let i = 0; i < docs.length; i++) {
      const targetDoc = docs[i];
      targetDoc.addEventListener('keydown', (e) => this.handleKeydown(e), { capture: true, signal });
      targetDoc.addEventListener('keyup', (e) => this.handleKeyup(e), { capture: true, signal });
    }
  }

  handleKeydown(event) {
    if (logger.isEnabled(LOG_LEVELS.VERBOSE)) {
      logger.verbose(
        `keydown code=${event.code} key=${event.key} keyCode=${event.keyCode}`
      );
    }

    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.key === 'Process' ||
      event.key === 'Dead'
    ) {
      return;
    }

    if (
      this.lastTimeStamp === event.timeStamp &&
      this.lastKeyCode === event.keyCode &&
      this.lastCode === event.code &&
      this.lastKey === event.key &&
      this.lastType === event.type
    ) {
      return;
    }
    this.lastTimeStamp = event.timeStamp;
    this.lastKeyCode = event.keyCode;
    this.lastCode = event.code;
    this.lastKey = event.key;
    this.lastType = event.type;

    this.arbitration.classifier.observeInput(event);

    if (this.isTypingContext(event)) {
      return false;
    }

    if (!stateManager.hasControllers()) {
      return false;
    }

    const keyBinding = this.config.matchKeyboardEvent(event);
    if (keyBinding) {
      this.actionHandler.runAction(keyBinding.action, keyBinding.value, event);
      if (this.config.settings.exclusiveKeys) {
        event.preventDefault();
        event.stopPropagation();
      }
    } else {
      this.arbitration.classifier.observeUnhandledKey(event);
    }
    return false;
  }

  handleKeyup(event) {
    const media = this.arbitration.classifier.observeKeyEnd(event);
    if (media) {
      this.arbitration.noteTemporaryOverrideEnd(media);
    }
  }

  isTypingContext(event) {
    const pathTarget =
      typeof event.composedPath === 'function' ? event.composedPath()[0] : event.target;
    const node = pathTarget || event.target;
    if (node) {
      const name = node.nodeName;
      if (name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT' || node.isContentEditable) {
        return true;
      }
    }
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    if (active && active !== node) {
      const name = active.nodeName;
      if (name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT' || active.isContentEditable) {
        return true;
      }
    }
    return false;
  }

  setupRateChangeListener(doc) {
    doc.addEventListener('ratechange', (e) => this.handleRateChange(e), {
      capture: true,
      signal: this.abortController.signal,
    });
  }

  setupUserGestureListener(doc) {
    const { signal } = this.abortController;
    const isInsideController = (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
      if (path) {
        for (let i = 0; i < path.length; i++) {
          if (path[i]?.tagName === 'VSC-CONTROLLER') return true;
        }
        return false;
      }
      return Boolean(event.target?.closest?.('vsc-controller'));
    };

    doc.addEventListener(
      'click',
      (event) => {
        if (isInsideController(event)) return;
        this.arbitration.classifier.observeClick(event, this.resolveGestureMedia(event));
      },
      { capture: true, passive: true, signal }
    );

    doc.addEventListener(
      'pointerdown',
      (event) => {
        if (isInsideController(event)) return;
        this.arbitration.classifier.observePointerDown(event, this.resolveGestureMedia(event));
      },
      { capture: true, passive: true, signal }
    );

    const onPointerEnd = (event) => {
      const ended = this.arbitration.classifier.observePointerEnd(event);
      for (let i = 0; i < ended.length; i++) {
        this.arbitration.noteTemporaryOverrideEnd(ended[i]);
      }
    };
    doc.addEventListener('pointerup', onPointerEnd, { capture: true, passive: true, signal });
    doc.addEventListener('pointercancel', onPointerEnd, { capture: true, passive: true, signal });

    doc.addEventListener(
      'pointermove',
      (event) => {
        if (event.timeStamp - this.lastMoveSample >= POINTER_MOVE_THROTTLE_MS) {
          this.lastMoveSample = event.timeStamp;
          this.arbitration.classifier.observeInput(event);
        }
      },
      { capture: true, passive: true, signal }
    );

    doc.addEventListener(
      'touchstart',
      (event) => this.arbitration.classifier.observeInput(event),
      { capture: true, passive: true, signal }
    );

    const retireHolds = () => {
      const affected = this.arbitration.classifier.clearTemporaryHolds();
      for (let i = 0; i < affected.length; i++) {
        this.arbitration.noteTemporaryOverrideEnd(affected[i]);
      }
    };

    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    if (win) {
      win.addEventListener('blur', retireHolds, { capture: false, signal });
      win.addEventListener('pagehide', retireHolds, { capture: false, signal });
    }
    doc.addEventListener(
      'visibilitychange',
      () => {
        if (doc.hidden) retireHolds();
      },
      { capture: true, signal }
    );
  }

  resolveGestureMedia(event) {
    if (stateManager.controllers.size <= 1) {
      return null;
    }

    const mediaElements = stateManager.getControlledElements();
    if (mediaElements.length <= 1) {
      return null;
    }

    const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    if (path) {
      let match = null;
      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        if (node?.vsc && mediaElements.indexOf(node) !== -1) {
          if (match !== null && match !== node) {
            return null;
          }
          match = node;
        }
      }
      if (match) return match;
    }

    return siteHandlerManager.resolveGestureMedia(event, mediaElements);
  }

  handleRateChange(event) {
    let video = event.target;
    if (!video?.vsc && typeof event.composedPath === 'function') {
      const path = event.composedPath();
      for (let i = 0; i < path.length; i++) {
        if (path[i]?.vsc) {
          video = path[i];
          break;
        }
      }
    }
    if (!video?.vsc) return;

    const echo = this.arbitration.consumeEcho(video, video.playbackRate);
    if (echo) {
      if (echo.suppressPropagation) {
        event.stopImmediatePropagation?.();
      } else {
        this.arbitration.observePropagatedEcho(video, event, echo);
      }
      return;
    }

    const reaction = this.arbitration.consumeEchoReaction(video, event);
    if (reaction === null) {
      event.stopImmediatePropagation?.();
      return;
    }

    const verdict = reaction
      ? CLASSIFIER_VERDICTS.AUTONOMOUS
      : this.arbitration.classifier.classify({
          media: video,
          rate: video.playbackRate,
          timeStamp: event.timeStamp,
          readyState: video.readyState,
          detail: event.detail,
        });

    if (verdict === CLASSIFIER_VERDICTS.SELF || verdict === CLASSIFIER_VERDICTS.INIT_NOISE) {
      return;
    }

    this.arbitration.onExternalRate(video, video.playbackRate, verdict, event, this.actionHandler, {
      suppressRetryEcho: reaction,
    });
  }

  refreshClassifierRules() {
    this.arbitration.updateClassifierRules(siteHandlerManager.getClassifierRules());
  }

  cleanup() {
    this.abortController.abort();
    this.arbitration.cleanup();
  }
}


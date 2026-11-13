import {
  DEFAULT_SETTINGS,
  REG_STRIP,
  PREDEFINED_ACTIONS,
  clampSpeed,
  roundSpeed,
} from '../utils/constants.js';
import { matchSiteRule } from '../utils/site-pattern.js';
import { logger } from '../utils/logger.js';
import { StorageManager } from './storage-manager.js';
import {
  createDefaultSitePositions,
  normalizePosition,
  normalizeSitePositions,
  resolveSitePosition,
} from './position.js';

const SAVE_DELAY = 1000;

function hasAnyModifier(mod) {
  return !!(mod && (mod.shift || mod.ctrl || mod.alt || mod.meta));
}

export class VideoSpeedConfig {
  constructor() {
    this.settings = VideoSpeedConfig.cloneDefaults();
    this.pendingSave = null;
    this.saveTimer = null;
    this.unsubscribeStorage = null;

    // Pre-indexed O(1) lookup structures for runtime hot paths
    this.bindingsByAction = new Map();
    this.bindingsByCode = new Map();
    this.bindingsByKeyCode = new Map();
    this.rebuildIndexes();
  }

  static cloneDefaults() {
    return {
      ...DEFAULT_SETTINGS,
      defaultPosition: normalizePosition(DEFAULT_SETTINGS.defaultPosition),
      sitePositions: createDefaultSitePositions(),
      keyBindings: DEFAULT_SETTINGS.keyBindings.map((kb) => ({ ...kb })),
      siteRules: DEFAULT_SETTINGS.siteRules.map((rule) => ({ ...rule })),
      siteDefaultSpeed: null,
      _abort: false,
    };
  }

  static normalizeKeyBinding(binding) {
    if (!binding || typeof binding !== 'object') return binding;
    const normalized = { ...binding };
    if (normalized.modifiers && typeof normalized.modifiers === 'object') {
      const shift = Boolean(normalized.modifiers.shift);
      const ctrl = Boolean(normalized.modifiers.ctrl);
      const alt = Boolean(normalized.modifiers.alt);
      const meta = Boolean(normalized.modifiers.meta);
      if (shift || ctrl || alt || meta) {
        normalized.modifiers = { shift, ctrl, alt, meta };
      } else {
        delete normalized.modifiers;
      }
    } else {
      delete normalized.modifiers;
    }
    return normalized;
  }

  rebuildIndexes() {
    this.bindingsByAction.clear();
    this.bindingsByCode.clear();
    this.bindingsByKeyCode.clear();

    const list = this.settings.keyBindings;
    if (!Array.isArray(list)) return;

    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || !b.action) continue;
      if (!this.bindingsByAction.has(b.action)) {
        this.bindingsByAction.set(b.action, b);
      }

      if (b.code) {
        let bucket = this.bindingsByCode.get(b.code);
        if (!bucket) {
          bucket = [];
          this.bindingsByCode.set(b.code, bucket);
        }
        bucket.push(b);
      }

      const kc = b.keyCode ?? b.key;
      if (typeof kc === 'number' && Number.isFinite(kc)) {
        let kcBucket = this.bindingsByKeyCode.get(kc);
        if (!kcBucket) {
          kcBucket = [];
          this.bindingsByKeyCode.set(kc, kcBucket);
        }
        kcBucket.push(b);
      }
    }

    // Sort code buckets so chorded bindings evaluate before simple ones
    for (const bucket of this.bindingsByCode.values()) {
      if (bucket.length > 1) {
        bucket.sort((a, b) => (a.modifiers ? -1 : 1) - (b.modifiers ? -1 : 1));
      }
    }
    for (const bucket of this.bindingsByKeyCode.values()) {
      if (bucket.length > 1) {
        bucket.sort((a, b) => (a.modifiers ? -1 : 1) - (b.modifiers ? -1 : 1));
      }
    }
  }

  setupStorageListener() {
    if (this.unsubscribeStorage) return;
    this.unsubscribeStorage = StorageManager.onChanged((changes) => {
      let changedBindings = false;
      for (const [key, change] of Object.entries(changes)) {
        // Session isolation (#1559): ignore external lastSpeed writes
        if (key === 'lastSpeed' || key === 'customCSS' || key === 'controllerCSS') continue;
        if (change && 'newValue' in change) {
          if (key === 'keyBindings' && Array.isArray(change.newValue)) {
            this.settings.keyBindings = change.newValue.map(VideoSpeedConfig.normalizeKeyBinding);
            changedBindings = true;
          } else if (key === 'defaultPosition') {
            this.settings.defaultPosition = normalizePosition(change.newValue);
          } else if (key === 'sitePositions') {
            this.settings.sitePositions = Array.isArray(change.newValue)
              ? normalizeSitePositions(change.newValue)
              : createDefaultSitePositions();
          } else {
            this.settings[key] = change.newValue;
          }
          if (key === 'logLevel') {
            logger.setVerbosity(change.newValue);
          }
        }
      }
      if (changedBindings) {
        this.rebuildIndexes();
      }
    });
  }

  teardownStorageListener() {
    if (this.unsubscribeStorage) {
      this.unsubscribeStorage();
      this.unsubscribeStorage = null;
    }
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.pendingSave = null;
    }
  }

  async load() {
    try {
      this.settings.siteDefaultSpeed = null;
      this.settings._abort = false;

      const requestShape = {
        ...DEFAULT_SETTINGS,
        keyBindings: undefined,
        siteRules: undefined,
        blacklist: undefined,
        defaultPosition: undefined,
        sitePositions: undefined,
        controllerCSS: null,
        customCSS: null,
      };

      const storage = await StorageManager.get(requestShape);
      if (!storage) {
        this.settings._abort = true;
        return this.settings;
      }

      const obsoleteKeys = [];
      if (storage.controllerCSS !== null && storage.controllerCSS !== undefined) {
        obsoleteKeys.push('controllerCSS');
      }
      if (storage.customCSS !== null && storage.customCSS !== undefined) {
        obsoleteKeys.push('customCSS');
      }
      if (obsoleteKeys.length > 0) {
        StorageManager.remove(obsoleteKeys).catch(() => {});
      }

      // Migrate legacy newline-delimited blacklist -> siteRules if siteRules absent
      let siteRules = storage.siteRules;
      if (!Array.isArray(siteRules) && typeof storage.blacklist === 'string') {
        siteRules = storage.blacklist
          .split('\n')
          .map((line) => line.replace(REG_STRIP, ''))
          .filter(Boolean)
          .map((pattern) => ({ pattern, enabled: false, speed: null }));
        StorageManager.set({ siteRules }).catch(() => {});
      }
      if (!Array.isArray(siteRules)) {
        siteRules = DEFAULT_SETTINGS.siteRules.map((r) => ({ ...r }));
      }

      const keyBindings =
        Array.isArray(storage.keyBindings) && storage.keyBindings.length > 0
          ? storage.keyBindings.map(VideoSpeedConfig.normalizeKeyBinding)
          : DEFAULT_SETTINGS.keyBindings.map((kb) => ({ ...kb }));

      const defaultPosition = normalizePosition(storage.defaultPosition);
      const sitePositions = Array.isArray(storage.sitePositions)
        ? normalizeSitePositions(storage.sitePositions)
        : createDefaultSitePositions();

      // Apply loaded fields cleanly
      Object.assign(this.settings, {
        schemaVersion: storage.schemaVersion ?? DEFAULT_SETTINGS.schemaVersion,
        enabled: storage.enabled !== false,
        rememberSpeed: Boolean(storage.rememberSpeed),
        exclusiveKeys: Boolean(storage.exclusiveKeys),
        audioBoolean: storage.audioBoolean !== false,
        startHidden: Boolean(storage.startHidden),
        controllerOpacity:
          typeof storage.controllerOpacity === 'number' && Number.isFinite(storage.controllerOpacity)
            ? storage.controllerOpacity
            : DEFAULT_SETTINGS.controllerOpacity,
        controllerButtonSize:
          typeof storage.controllerButtonSize === 'number' &&
          Number.isFinite(storage.controllerButtonSize)
            ? storage.controllerButtonSize
            : DEFAULT_SETTINGS.controllerButtonSize,
        defaultPosition,
        sitePositions,
        keyBindings,
        siteRules,
        defaultLogLevel: storage.defaultLogLevel ?? DEFAULT_SETTINGS.defaultLogLevel,
        logLevel: storage.logLevel ?? DEFAULT_SETTINGS.logLevel,
      });

      this.evaluateSiteRule(typeof location !== 'undefined' ? location.href : '');

      const remembered = Number(storage.lastSpeed);
      if (this.settings.siteDefaultSpeed !== null) {
        this.settings.lastSpeed = this.settings.siteDefaultSpeed;
      } else if (this.settings.rememberSpeed && Number.isFinite(remembered) && remembered > 0) {
        this.settings.lastSpeed = clampSpeed(roundSpeed(remembered));
      } else {
        this.settings.lastSpeed = null; // NO_OPINION
      }

      logger.setDefaultLevel(this.settings.defaultLogLevel);
      logger.setVerbosity(this.settings.logLevel);

      this.rebuildIndexes();
      this.setupStorageListener();
      return this.settings;
    } catch (error) {
      logger.error(`Failed to load config: ${error.message}`);
      this.settings._abort = true;
      return this.settings;
    }
  }

  evaluateSiteRule(url) {
    const matched = matchSiteRule(this.settings.siteRules, url);
    if (matched && typeof matched.speed === 'number' && Number.isFinite(matched.speed)) {
      this.settings.siteDefaultSpeed = clampSpeed(roundSpeed(matched.speed));
    } else {
      this.settings.siteDefaultSpeed = null;
    }
    return matched;
  }

  resolvePosition(url = typeof location !== 'undefined' ? location.href : '') {
    return resolveSitePosition(this.settings.sitePositions, this.settings.defaultPosition, url);
  }

  /**
   * Claim document-session desired authority and persist when rememberSpeed is active.
   */
  persistAuthority(speed) {
    this.settings.lastSpeed = speed;
    if (!this.settings.rememberSpeed) {
      return;
    }
    this.scheduleLastSpeedSave(speed);
  }

  scheduleLastSpeedSave(speed) {
    this.pendingSave = speed;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      const value = this.pendingSave;
      this.pendingSave = null;
      this.saveTimer = null;
      if (typeof value === 'number' && Number.isFinite(value)) {
        StorageManager.set({ lastSpeed: value }).catch((err) => {
          logger.error(`Failed to persist lastSpeed: ${err.message}`);
        });
      }
    }, SAVE_DELAY);
  }

  async save(newSettings = {}) {
    try {
      const cleaned = { ...newSettings };
      delete cleaned.customCSS;
      if (Array.isArray(cleaned.keyBindings)) {
        cleaned.keyBindings = cleaned.keyBindings.map(VideoSpeedConfig.normalizeKeyBinding);
      }
      if ('defaultPosition' in cleaned) {
        cleaned.defaultPosition = normalizePosition(cleaned.defaultPosition);
      }
      if ('sitePositions' in cleaned) {
        cleaned.sitePositions = Array.isArray(cleaned.sitePositions)
          ? normalizeSitePositions(cleaned.sitePositions)
          : createDefaultSitePositions();
      }

      Object.assign(this.settings, cleaned);

      if ('logLevel' in cleaned) {
        logger.setVerbosity(cleaned.logLevel);
      }
      if ('keyBindings' in cleaned) {
        this.rebuildIndexes();
      }

      // If strictly saving { lastSpeed } in runtime, keep debounced
      const keys = Object.keys(cleaned);
      if (keys.length === 1 && keys[0] === 'lastSpeed') {
        this.scheduleLastSpeedSave(cleaned.lastSpeed);
        return true;
      }

      return await StorageManager.set(cleaned);
    } catch (error) {
      logger.error(`Failed to save settings: ${error.message}`);
      return false;
    }
  }

  getKeyBinding(action, property = 'value') {
    const binding = this.bindingsByAction.get(action);
    if (!binding) return false;
    return binding[property];
  }

  setKeyBinding(action, value) {
    const binding = this.bindingsByAction.get(action);
    if (!binding) return;
    if (PREDEFINED_ACTIONS.includes(action) || typeof binding.value === 'number') {
      binding.value = value;
    }
  }

  /**
   * Fast O(1) shortcut matching implementing 3-tier precedence:
   *   Tier 1: Chorded binding matching event.code + exact modifiers
   *   Tier 2: Simple binding matching event.code without ctrl/alt/meta
   *   Tier 3: Legacy binding missing code matching keyCode without ctrl/alt/meta
   * Plus Unidentified/empty-code fallback on keyCode + modifier match.
   */
  matchKeyboardEvent(event) {
    const code = event.code;
    const keyCode = event.keyCode;
    const ctrl = !!event.ctrlKey;
    const alt = !!event.altKey;
    const meta = !!event.metaKey;
    const shift = !!event.shiftKey;
    const hasModifier = ctrl || alt || meta;

    if (!code || code === 'Unidentified') {
      const kcBucket = this.bindingsByKeyCode.get(keyCode);
      if (!kcBucket) return undefined;
      for (let i = 0; i < kcBucket.length; i++) {
        const b = kcBucket[i];
        if (b.modifiers) {
          if (
            Boolean(b.modifiers.ctrl) === ctrl &&
            Boolean(b.modifiers.alt) === alt &&
            Boolean(b.modifiers.meta) === meta &&
            Boolean(b.modifiers.shift) === shift
          ) {
            return b;
          }
        } else if (!hasModifier) {
          return b;
        }
      }
      return undefined;
    }

    const codeBucket = this.bindingsByCode.get(code);
    if (codeBucket) {
      // Tier 1: Chord match (sorted first)
      for (let i = 0; i < codeBucket.length; i++) {
        const b = codeBucket[i];
        if (b.modifiers) {
          if (
            Boolean(b.modifiers.ctrl) === ctrl &&
            Boolean(b.modifiers.alt) === alt &&
            Boolean(b.modifiers.meta) === meta &&
            Boolean(b.modifiers.shift) === shift
          ) {
            return b;
          }
        } else if (!hasModifier && !hasAnyModifier(b.modifiers)) {
          // Tier 2: Simple code match
          return b;
        }
      }
    }

    // Tier 3: Legacy unmapped/code==null fallback
    if (!hasModifier) {
      const kcBucket = this.bindingsByKeyCode.get(keyCode);
      if (kcBucket) {
        for (let i = 0; i < kcBucket.length; i++) {
          const b = kcBucket[i];
          if ((b.code === null || b.code === undefined) && !b.modifiers) {
            return b;
          }
        }
      }
    }

    return undefined;
  }
}

export const videoSpeedConfig = new VideoSpeedConfig();


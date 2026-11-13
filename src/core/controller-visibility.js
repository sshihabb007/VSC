/**
 * Pure controller-visibility state machine.
 */

export class ControllerVisibility {
  static OVERRIDES = Object.freeze({
    AUTO: 'auto',
    SHOW: 'show',
    HIDE: 'hide',
  });

  static FLASH = Object.freeze({
    NONE: 'none',
    TIMED_ARMED: 'timed-armed',
    TIMED_DUE: 'timed-due',
    PERSISTENT: 'persistent',
  });

  static MEDIA_TYPES = Object.freeze({
    VIDEO: 'video',
    AUDIO: 'audio',
  });

  static EVENTS = Object.freeze({
    TOGGLE: 'TOGGLE',
    FLASH_REQUEST: 'FLASH_REQUEST',
    TIMER_TICK: 'TIMER_TICK',
    FLASH_EXPIRE: 'FLASH_EXPIRE',
    AUTOMATIC_HIDE: 'AUTOMATIC_HIDE',
    AUTOMATIC_SHOW: 'AUTOMATIC_SHOW',
    SET_SITE_AUTOHIDE: 'SET_SITE_AUTOHIDE',
    SET_SOURCE_AVAILABLE: 'SET_SOURCE_AVAILABLE',
    SET_HOST_HIDDEN: 'SET_HOST_HIDDEN',
    SET_START_HIDDEN: 'SET_START_HIDDEN',
    RELEASE: 'RELEASE',
  });

  static createState(values = {}) {
    const state = {
      attached: true,
      override: this.OVERRIDES.AUTO,
      automaticHidden: false,
      noSource: false,
      siteAutohide: false,
      hostHidden: false,
      flash: this.FLASH.NONE,
      startHidden: false,
      mediaType: this.MEDIA_TYPES.VIDEO,
      ...values,
    };
    this.assertState(state);
    return state;
  }

  static normalizeOverride(value) {
    if (value === 'show' || value === 'hide' || value === 'auto') {
      return value;
    }
    return this.OVERRIDES.AUTO;
  }

  static isVisible(state) {
    this.assertState(state);
    if (
      !state.attached ||
      state.hostHidden ||
      state.noSource ||
      state.override === this.OVERRIDES.HIDE
    ) {
      return false;
    }
    if (state.override === this.OVERRIDES.SHOW || state.flash !== this.FLASH.NONE) {
      return true;
    }
    return !state.automaticHidden && !state.siteAutohide;
  }

  static nextOverride(override, renderedVisible) {
    const current = this.normalizeOverride(override);
    if (current === this.OVERRIDES.SHOW) return this.OVERRIDES.HIDE;
    if (current === this.OVERRIDES.HIDE) return this.OVERRIDES.SHOW;
    if (typeof renderedVisible !== 'boolean') {
      throw new TypeError('renderedVisible must be boolean when toggling from AUTO');
    }
    return renderedVisible ? this.OVERRIDES.HIDE : this.OVERRIDES.SHOW;
  }

  static allowsFlash(input) {
    return (
      input?.attached !== false &&
      !input?.startHidden &&
      this.normalizeOverride(input?.override) !== this.OVERRIDES.HIDE
    );
  }

  static step(state, event) {
    this.assertState(state);
    if (!event || typeof event.type !== 'string') {
      throw new TypeError('visibility event requires a type');
    }

    const next = { ...state };
    switch (event.type) {
      case this.EVENTS.TOGGLE:
        if (state.attached) {
          const renderedVisible =
            event.renderedVisible === undefined
              ? this.isVisible(state)
              : this.requireBoolean(event.renderedVisible, 'renderedVisible');
          next.override = this.nextOverride(state.override, renderedVisible);
          next.flash = this.FLASH.NONE;
        }
        break;

      case this.EVENTS.FLASH_REQUEST:
        if (this.allowsFlash(state)) {
          next.flash =
            state.mediaType === this.MEDIA_TYPES.AUDIO
              ? this.FLASH.PERSISTENT
              : this.FLASH.TIMED_ARMED;
        }
        break;

      case this.EVENTS.TIMER_TICK:
        if (state.attached && state.flash === this.FLASH.TIMED_ARMED) {
          next.flash = this.FLASH.TIMED_DUE;
        }
        break;

      case this.EVENTS.FLASH_EXPIRE:
        if (state.attached && state.flash === this.FLASH.TIMED_DUE) {
          next.flash = this.FLASH.NONE;
        }
        break;

      case this.EVENTS.AUTOMATIC_HIDE:
        if (state.attached) next.automaticHidden = true;
        break;

      case this.EVENTS.AUTOMATIC_SHOW:
        if (state.attached && !state.startHidden) next.automaticHidden = false;
        break;

      case this.EVENTS.SET_SITE_AUTOHIDE:
        if (state.attached) next.siteAutohide = this.requireBoolean(event.value, 'value');
        break;

      case this.EVENTS.SET_SOURCE_AVAILABLE:
        if (state.attached) next.noSource = !this.requireBoolean(event.value, 'value');
        break;

      case this.EVENTS.SET_HOST_HIDDEN:
        if (state.attached) next.hostHidden = this.requireBoolean(event.value, 'value');
        break;

      case this.EVENTS.SET_START_HIDDEN:
        next.startHidden = this.requireBoolean(event.value, 'value');
        break;

      case this.EVENTS.RELEASE:
        next.attached = false;
        next.override = this.OVERRIDES.AUTO;
        next.flash = this.FLASH.NONE;
        break;

      default:
        throw new TypeError(`Unknown visibility event ${event.type}`);
    }

    this.assertState(next);
    return next;
  }

  static requireBoolean(value, name) {
    if (typeof value !== 'boolean') {
      throw new TypeError(`${name} must be boolean`);
    }
    return value;
  }

  static assertState(state) {
    if (!state || typeof state !== 'object') {
      throw new TypeError('visibility state must be an object');
    }
    for (const key of [
      'attached',
      'automaticHidden',
      'noSource',
      'siteAutohide',
      'hostHidden',
      'startHidden',
    ]) {
      this.requireBoolean(state[key], key);
    }
    if (!['auto', 'show', 'hide'].includes(state.override)) {
      throw new TypeError(`invalid visibility override ${state.override}`);
    }
    if (!['none', 'timed-armed', 'timed-due', 'persistent'].includes(state.flash)) {
      throw new TypeError(`invalid flash state ${state.flash}`);
    }
    if (!['video', 'audio'].includes(state.mediaType)) {
      throw new TypeError(`invalid media type ${state.mediaType}`);
    }
    if (!state.attached && (state.override !== 'auto' || state.flash !== 'none')) {
      throw new TypeError('detached visibility state must be AUTO with no flash');
    }
    if (
      state.mediaType === 'audio' &&
      (state.flash === 'timed-armed' || state.flash === 'timed-due')
    ) {
      throw new TypeError('audio visibility state cannot carry a timed flash');
    }
    if (state.mediaType === 'video' && state.flash === 'persistent') {
      throw new TypeError('video visibility state cannot carry a persistent flash');
    }
    if (state.override === 'hide' && state.flash !== 'none') {
      throw new TypeError('explicit HIDE cannot coexist with flash');
    }
  }
}


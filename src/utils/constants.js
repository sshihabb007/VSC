import {
  PREDEFINED_CODE_MAP,
  KEYCODE_TO_CODE,
  displayKeyFromCode,
  PREDEFINED_ACTIONS,
  BLACKLISTED_CODES,
  DEFAULT_BINDINGS,
} from './key-maps.js';
import { DEFAULT_CONTROLLER_CSS } from '../styles/controller-css-defaults.js';

export const REG_STRIP = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
export const REG_ENDS_WITH_FLAGS = /\/(?!.*(.).*\1)[gimsuy]*$/;

export const LOG_LEVELS = Object.freeze({
  NONE: 1,
  ERROR: 2,
  WARNING: 3,
  INFO: 4,
  DEBUG: 5,
  VERBOSE: 6,
});

export const MESSAGE_TYPES = Object.freeze({
  SET_SPEED: 'VSC_SET_SPEED',
  ADJUST_SPEED: 'VSC_ADJUST_SPEED',
  RESET_SPEED: 'VSC_RESET_SPEED',
  TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY',
  TEARDOWN: 'VSC_TEARDOWN',
  QUERY_STATE: 'VSC_QUERY_STATE',
  STATE_REPLY: 'VSC_STATE_REPLY',
});

export const SPEED_LIMITS = Object.freeze({
  MIN: 0.07,
  MAX: 16,
});

export const CONTROLLER_SIZE_LIMITS = Object.freeze({
  VIDEO_MIN_WIDTH: 40,
  VIDEO_MIN_HEIGHT: 40,
  AUDIO_MIN_WIDTH: 20,
  AUDIO_MIN_HEIGHT: 20,
});

export const CUSTOM_ACTIONS_NO_VALUES = Object.freeze(['pause', 'muted', 'mark', 'jump', 'display']);

export const POSITION_ANCHORS = Object.freeze({
  'top-left': Object.freeze({ id: 'top-left', row: 'top', col: 'left', label: 'Top Left' }),
  top: Object.freeze({ id: 'top', row: 'top', col: 'center', label: 'Top' }),
  'top-right': Object.freeze({ id: 'top-right', row: 'top', col: 'right', label: 'Top Right' }),
  left: Object.freeze({ id: 'left', row: 'middle', col: 'left', label: 'Left' }),
  right: Object.freeze({ id: 'right', row: 'middle', col: 'right', label: 'Right' }),
  'bottom-left': Object.freeze({ id: 'bottom-left', row: 'bottom', col: 'left', label: 'Bottom Left' }),
  bottom: Object.freeze({ id: 'bottom', row: 'bottom', col: 'center', label: 'Bottom' }),
  'bottom-right': Object.freeze({ id: 'bottom-right', row: 'bottom', col: 'right', label: 'Bottom Right' }),
});

export const POSITION_ANCHOR_ORDER = Object.freeze([
  'top-left',
  'top',
  'top-right',
  'left',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
]);

export const DEFAULT_POSITION = Object.freeze({
  anchor: 'top-left',
  offsetX: 0,
  offsetY: 50,
});

export const BUILTIN_PLATFORM_PRESETS = Object.freeze([
  Object.freeze({
    id: 'youtube',
    label: 'YouTube',
    pattern: 'youtube.com',
    anchor: 'top-left',
    offsetX: 0,
    offsetY: 50,
    builtin: true,
    enabled: true,
  }),
  Object.freeze({
    id: 'facebook',
    label: 'Facebook',
    pattern: 'facebook.com',
    anchor: 'top-left',
    offsetX: 0,
    offsetY: 60,
    builtin: true,
    enabled: true,
  }),
  Object.freeze({
    id: 'instagram',
    label: 'Instagram',
    pattern: 'instagram.com',
    anchor: 'top-left',
    offsetX: 0,
    offsetY: 50,
    builtin: true,
    enabled: true,
  }),
  Object.freeze({
    id: 'x',
    label: 'X (Twitter)',
    pattern: '/(^|\\.|\\/\\/)(x|twitter)\\.com(\\/|:|$)/i',
    anchor: 'top-left',
    offsetX: 0,
    offsetY: 50,
    builtin: true,
    enabled: true,
  }),
]);

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 2,
  lastSpeed: 1.0,
  enabled: true,
  rememberSpeed: false,
  exclusiveKeys: false,
  audioBoolean: true,
  startHidden: false,
  controllerOpacity: 0.3,
  controllerButtonSize: 8,
  defaultPosition: DEFAULT_POSITION,
  sitePositions: BUILTIN_PLATFORM_PRESETS,
  keyBindings: Object.freeze(
    PREDEFINED_ACTIONS.map((action) => ({
      action,
      ...DEFAULT_BINDINGS[action],
      predefined: true,
    }))
  ),
  siteRules: Object.freeze([
    Object.freeze({ pattern: 'imgur.com', enabled: false, speed: null }),
    Object.freeze({ pattern: 'teams.microsoft.com', enabled: false, speed: null }),
    Object.freeze({ pattern: 'meet.google.com', enabled: false, speed: null }),
  ]),
  blacklist: 'imgur.com\nteams.microsoft.com\nmeet.google.com',
  defaultLogLevel: 4,
  logLevel: 3,
});

export function clampSpeed(speed) {
  return Math.min(Math.max(speed, SPEED_LIMITS.MIN), SPEED_LIMITS.MAX);
}

/** Round to 2 decimal places without intermediate string allocation. */
export function roundSpeed(speed) {
  return Math.round((speed + Number.EPSILON) * 100) / 100;
}

export function formatSpeed(speed) {
  return speed.toFixed(2);
}

export {
  DEFAULT_CONTROLLER_CSS,
  PREDEFINED_CODE_MAP,
  KEYCODE_TO_CODE,
  displayKeyFromCode,
  PREDEFINED_ACTIONS,
  BLACKLISTED_CODES,
  DEFAULT_BINDINGS,
};


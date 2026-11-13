/**
 * Pure keyboard identity maps shared across service worker, page runtime, and options UI.
 */

export const PREDEFINED_CODE_MAP = Object.freeze({
  88: { code: 'KeyX', displayKey: 'x' },
  67: { code: 'KeyC', displayKey: 'c' },
  83: { code: 'KeyS', displayKey: 's' },
  68: { code: 'KeyD', displayKey: 'd' },
  90: { code: 'KeyZ', displayKey: 'z' },
  82: { code: 'KeyR', displayKey: 'r' },
  71: { code: 'KeyG', displayKey: 'g' },
  86: { code: 'KeyV', displayKey: 'v' },
  77: { code: 'KeyM', displayKey: 'm' },
  74: { code: 'KeyJ', displayKey: 'j' },
});

export const KEYCODE_TO_CODE = Object.freeze({
  8: 'Backspace',
  13: 'Enter',
  27: 'Escape',
  32: 'Space',
  46: 'Delete',
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown',
  48: 'Digit0',
  49: 'Digit1',
  50: 'Digit2',
  51: 'Digit3',
  52: 'Digit4',
  53: 'Digit5',
  54: 'Digit6',
  55: 'Digit7',
  56: 'Digit8',
  57: 'Digit9',
  65: 'KeyA',
  66: 'KeyB',
  67: 'KeyC',
  68: 'KeyD',
  69: 'KeyE',
  70: 'KeyF',
  71: 'KeyG',
  72: 'KeyH',
  73: 'KeyI',
  74: 'KeyJ',
  75: 'KeyK',
  76: 'KeyL',
  77: 'KeyM',
  78: 'KeyN',
  79: 'KeyO',
  80: 'KeyP',
  81: 'KeyQ',
  82: 'KeyR',
  83: 'KeyS',
  84: 'KeyT',
  85: 'KeyU',
  86: 'KeyV',
  87: 'KeyW',
  88: 'KeyX',
  89: 'KeyY',
  90: 'KeyZ',
  96: 'Numpad0',
  97: 'Numpad1',
  98: 'Numpad2',
  99: 'Numpad3',
  100: 'Numpad4',
  101: 'Numpad5',
  102: 'Numpad6',
  103: 'Numpad7',
  104: 'Numpad8',
  105: 'Numpad9',
  106: 'NumpadMultiply',
  107: 'NumpadAdd',
  109: 'NumpadSubtract',
  110: 'NumpadDecimal',
  111: 'NumpadDivide',
  112: 'F1',
  113: 'F2',
  114: 'F3',
  115: 'F4',
  116: 'F5',
  117: 'F6',
  118: 'F7',
  119: 'F8',
  120: 'F9',
  121: 'F10',
  122: 'F11',
  123: 'F12',
  124: 'F13',
  125: 'F14',
  126: 'F15',
  127: 'F16',
  128: 'F17',
  129: 'F18',
  130: 'F19',
  131: 'F20',
  132: 'F21',
  133: 'F22',
  134: 'F23',
  135: 'F24',
  144: 'NumLock',
  145: 'ScrollLock',
  186: 'Semicolon',
  187: 'Equal',
  188: 'Comma',
  189: 'Minus',
  190: 'Period',
  191: 'Slash',
  192: 'Backquote',
  219: 'BracketLeft',
  220: 'Backslash',
  221: 'BracketRight',
  222: 'Quote',
});

const NUMPAD_OPS = Object.freeze({
  NumpadEnter: 'Num Enter',
  NumpadMultiply: 'Num *',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadDecimal: 'Num .',
  NumpadDivide: 'Num /',
});

const PUNCTUATION_LABELS = Object.freeze({
  Semicolon: ';',
  Equal: '=',
  Comma: ',',
  Minus: '-',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  Backslash: '\\',
  BracketRight: ']',
  Quote: "'",
});

export function displayKeyFromCode(code) {
  if (!code) return '';
  if (code.startsWith('Key') && code.length === 4) {
    return code.charAt(3).toLowerCase();
  }
  if (code.startsWith('Digit') && code.length === 6) {
    return code.charAt(5);
  }
  if (code.startsWith('Numpad') && code.length === 7 && code[6] >= '0' && code[6] <= '9') {
    return `Num ${code.charAt(6)}`;
  }
  return NUMPAD_OPS[code] || PUNCTUATION_LABELS[code] || code;
}

export const PREDEFINED_ACTIONS = Object.freeze([
  'slower',
  'faster',
  'rewind',
  'advance',
  'reset',
  'fast',
  'display',
  'mark',
  'jump',
]);

export const DEFAULT_BINDINGS = Object.freeze({
  slower: Object.freeze({ code: 'KeyX', key: 88, keyCode: 88, displayKey: 'x', value: 0.1 }),
  faster: Object.freeze({ code: 'KeyC', key: 67, keyCode: 67, displayKey: 'c', value: 0.1 }),
  rewind: Object.freeze({ code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 5 }),
  advance: Object.freeze({ code: 'KeyD', key: 68, keyCode: 68, displayKey: 'd', value: 5 }),
  reset: Object.freeze({ code: 'KeyZ', key: 90, keyCode: 90, displayKey: 'z', value: 1.0 }),
  fast: Object.freeze({ code: 'KeyG', key: 71, keyCode: 71, displayKey: 'g', value: 1.6 }),
  display: Object.freeze({ code: 'KeyV', key: 86, keyCode: 86, displayKey: 'v', value: 0 }),
  mark: Object.freeze({ code: 'KeyM', key: 77, keyCode: 77, displayKey: 'm', value: 0 }),
  jump: Object.freeze({ code: 'KeyJ', key: 74, keyCode: 74, displayKey: 'j', value: 0 }),
});

export const BLACKLISTED_CODES = new Set([
  'Tab',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'ContextMenu',
  'CapsLock',
  'NumLock',
  'ScrollLock',
]);


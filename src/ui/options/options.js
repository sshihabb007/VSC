import {
  DEFAULT_SETTINGS,
  CUSTOM_ACTIONS_NO_VALUES,
  SPEED_LIMITS,
  BLACKLISTED_CODES,
  displayKeyFromCode,
} from '../../utils/constants.js';
import { validateSitePattern } from '../../utils/site-pattern.js';
import { StorageManager } from '../../core/storage-manager.js';
import { videoSpeedConfig } from '../../core/settings.js';
import {
  DEFAULT_POSITION,
  createDefaultSitePositions,
  validateSitePositionEntries,
} from '../../core/position.js';
import { createRow } from './row-renderer.js';
import { PositionStudio } from './position-studio.js';

let positionStudio = null;

const ACTION_OPTIONS = [
  ['slower', 'Decrease speed'],
  ['faster', 'Increase speed'],
  ['rewind', 'Rewind'],
  ['advance', 'Advance'],
  ['reset', 'Reset speed'],
  ['fast', 'Preferred speed'],
  ['muted', 'Mute'],
  ['softer', 'Decrease volume'],
  ['louder', 'Increase volume'],
  ['pause', 'Pause'],
  ['mark', 'Set marker'],
  ['jump', 'Jump to marker'],
  ['display', 'Show/hide controller'],
];

const SHORTCUT_COLUMNS = [
  { key: 'action', type: 'select', className: 'customDo', options: ACTION_OPTIONS },
  { key: 'keyInput', type: 'text', className: 'customKey', placeholder: 'press a key' },
  { key: 'value', type: 'text', className: 'customValue', placeholder: 'value (0.10)' },
];

const SITE_RULE_COLUMNS = [
  { key: 'pattern', type: 'text', className: 'rulePattern', placeholder: 'youtube.com or /regex/' },
  { key: 'disabled', type: 'checkbox', className: 'ruleDisabled', default: false },
  { key: 'speed', type: 'text', className: 'ruleSpeed', placeholder: 'default' },
];

const keyCodeAliases = {
  0: 'null',
  null: 'null',
  undefined: 'null',
  32: 'Space',
  37: 'Left',
  38: 'Up',
  39: 'Right',
  40: 'Down',
  96: 'Num 0',
  97: 'Num 1',
  98: 'Num 2',
  99: 'Num 3',
  100: 'Num 4',
  101: 'Num 5',
  102: 'Num 6',
  103: 'Num 7',
  104: 'Num 8',
  105: 'Num 9',
  106: 'Num *',
  107: 'Num +',
  109: 'Num -',
  110: 'Num .',
  111: 'Num /',
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
  186: ';',
  188: '<',
  189: '-',
  187: '+',
  190: '>',
  191: '/',
  192: '~',
  219: '[',
  220: '\\',
  221: ']',
  222: "'",
};

let layoutMap = null;
let statusTimer = 0;

// Canvas-based text measurement avoids synchronous DOM layout thrash per shortcut row
const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const measureCtx = measureCanvas?.getContext('2d') ?? null;

(async function initLayoutMap() {
  try {
    if (navigator.keyboard?.getLayoutMap) {
      layoutMap = await navigator.keyboard.getLayoutMap();
      navigator.keyboard.addEventListener('layoutchange', async () => {
        layoutMap = await navigator.keyboard.getLayoutMap();
      });
    }
  } catch {
    // Fallback chain handles systems without getLayoutMap
  }
})();

function showStatus(text, type = '', durationMs = 3000) {
  const status = document.getElementById('status');
  clearTimeout(statusTimer);
  status.textContent = text;
  status.className = type ? `show ${type}` : 'show';
  if (durationMs > 0) {
    statusTimer = setTimeout(() => {
      status.textContent = '';
      status.className = '';
    }, durationMs);
  }
}

function formatShortcutDisplay(displayKey, modifiers) {
  if (!displayKey) return 'null';
  const parts = [];
  if (modifiers) {
    if (modifiers.ctrl) parts.push('Ctrl');
    if (modifiers.alt) parts.push('Alt');
    if (modifiers.shift) parts.push('Shift');
    if (modifiers.meta) parts.push('Meta');
  }
  parts.push(displayKey.length === 1 ? displayKey.toUpperCase() : displayKey);
  return parts.join(' + ');
}

function resolveDisplayLabel(binding) {
  if (layoutMap && binding.code) {
    const mapped = layoutMap.get(binding.code);
    if (mapped) return formatShortcutDisplay(mapped, binding.modifiers);
  }
  if (binding.displayKey) {
    return formatShortcutDisplay(binding.displayKey, binding.modifiers);
  }
  if (binding.code) {
    return formatShortcutDisplay(displayKeyFromCode(binding.code), binding.modifiers);
  }
  const kc = binding.keyCode ?? binding.key;
  return keyCodeAliases[kc] || (kc >= 48 && kc <= 90 ? String.fromCharCode(kc) : `Key ${kc}`);
}

function autoSizeKeyInput(input) {
  const minWidth = 76;
  if (!input.value || input.value.length <= 3) {
    input.style.width = `${minWidth}px`;
    return;
  }
  if (measureCtx) {
    measureCtx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textWidth = Math.ceil(measureCtx.measureText(input.value).width);
    input.style.width = `${Math.max(minWidth, textWidth + 24)}px`;
  } else {
    input.style.width = `${Math.max(minWidth, input.value.length * 8 + 24)}px`;
  }
}

function clearWarning(input) {
  input.parentNode.querySelector('.shortcut-warning')?.remove();
}

function showWarning(input, message) {
  clearWarning(input);
  const warn = document.createElement('span');
  warn.className = 'shortcut-warning';
  warn.textContent = message;
  input.parentNode.insertBefore(warn, input.nextSibling);
}

function recordKeyPress(e) {
  if (e.code === 'Backspace') {
    e.target.value = '';
    e.target.code = null;
    e.target.keyCode = null;
    e.target.displayKey = null;
    e.target.modifiers = undefined;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.code === 'Escape') {
    e.target.value = 'null';
    e.target.code = null;
    e.target.keyCode = null;
    e.target.displayKey = null;
    e.target.modifiers = undefined;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (BLACKLISTED_CODES.has(e.code)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  e.target.code = e.code;
  e.target.keyCode = e.keyCode;
  const isNumpad = e.code.startsWith('Numpad');
  e.target.displayKey = isNumpad
    ? displayKeyFromCode(e.code) || e.key
    : layoutMap?.get(e.code) || displayKeyFromCode(e.code) || e.key;

  const hasMod = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
  e.target.modifiers = hasMod
    ? { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
    : undefined;

  e.target.value = formatShortcutDisplay(e.target.displayKey, e.target.modifiers);
  autoSizeKeyInput(e.target);

  clearWarning(e.target);
  if (e.ctrlKey && e.altKey) {
    showWarning(e.target, 'This combination may conflict with AltGr input.');
  } else if (e.metaKey) {
    showWarning(e.target, 'Some Cmd/Meta combinations are reserved by the OS.');
  }

  e.preventDefault();
  e.stopPropagation();
}

function setShortcutInput(input, binding) {
  input.code = binding.code;
  input.keyCode = binding.keyCode ?? binding.key;
  input.displayKey = binding.displayKey;
  input.modifiers = binding.modifiers;
  input.value = resolveDisplayLabel(binding);
  autoSizeKeyInput(input);
}

function add_shortcut(data = {}) {
  const container = document.getElementById('shortcuts-container');
  const row = createRow(container, SHORTCUT_COLUMNS, data, {
    className: 'customs',
    removable: true,
  });
  const action = data.action || row.querySelector('.customDo').value;
  if (CUSTOM_ACTIONS_NO_VALUES.includes(action)) {
    row.querySelector('.customValue').style.display = 'none';
  }
  return row;
}

function add_predefined_shortcut(data) {
  const container = document.getElementById('shortcuts-container');
  const row = createRow(
    container,
    SHORTCUT_COLUMNS,
    { action: data.action },
    { className: 'customs', id: data.action, removable: false }
  );
  row.querySelector('.customDo').disabled = true;
  setShortcutInput(row.querySelector('.customKey'), data);
  const valueInput = row.querySelector('.customValue');
  valueInput.value = data.value;
  if (CUSTOM_ACTIONS_NO_VALUES.includes(data.action)) {
    valueInput.style.display = 'none';
  }
  return row;
}

function add_site_rule(data = { enabled: true }) {
  const container = document.getElementById('site-rules-container');
  const speedDisplay = data.speed !== null && data.speed !== undefined ? data.speed : undefined;
  return createRow(
    container,
    SITE_RULE_COLUMNS,
    { pattern: data.pattern, disabled: !data.enabled, speed: speedDisplay },
    { className: 'site-rule', removable: true }
  );
}

function parseSpeed(s) {
  if (typeof s !== 'string') return s ?? null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  const v = parseFloat(trimmed);
  return Number.isFinite(v) ? v : null;
}

function collectSiteRules() {
  const container = document.getElementById('site-rules-container');
  return Array.from(container.querySelectorAll('.row.site-rule'))
    .map((row) => ({
      pattern: row.querySelector('.rulePattern').value.trim(),
      enabled: !row.querySelector('.ruleDisabled').checked,
      speed: parseSpeed(row.querySelector('.ruleSpeed').value),
    }))
    .filter((r) => r.pattern);
}

function collectKeyBindings() {
  return Array.from(document.querySelectorAll('.row.customs')).map((item) => {
    const action = item.querySelector('.customDo').value;
    const input = item.querySelector('.customKey');
    const value = Number(item.querySelector('.customValue').value) || 0;
    const predefined = Boolean(item.id);

    const binding = {
      action,
      code: input.code,
      key: input.keyCode,
      keyCode: input.keyCode,
      displayKey: input.displayKey,
      value,
      predefined,
    };
    if (input.modifiers) {
      binding.modifiers = input.modifiers;
    }
    return binding;
  });
}

function validate() {
  const rulesMsg = document.getElementById('siteRulesValidation');
  rulesMsg.className = 'css-validation';
  rulesMsg.textContent = '';

  const opacity = Number(document.getElementById('controllerOpacity').value);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    showStatus('Error: Controller opacity must be between 0 and 1.', 'error', 4000);
    return false;
  }

  const buttonSize = Number(document.getElementById('controllerButtonSize').value);
  if (!Number.isFinite(buttonSize) || buttonSize < 6 || buttonSize > 48) {
    showStatus('Error: Button size must be between 6 and 48 px.', 'error', 4000);
    return false;
  }

  const rules = collectSiteRules();
  for (const rule of rules) {
    const res = validateSitePattern(rule.pattern);
    if (!res.valid) {
      rulesMsg.classList.add('error');
      rulesMsg.textContent = res.error;
      showStatus(`Error: ${res.error}`, 'error', 4500);
      return false;
    }
    if (rule.speed !== null && (rule.speed < SPEED_LIMITS.MIN || rule.speed > SPEED_LIMITS.MAX)) {
      const err = `Speed for "${rule.pattern}" must be between ${SPEED_LIMITS.MIN} and ${SPEED_LIMITS.MAX}.`;
      rulesMsg.classList.add('error');
      rulesMsg.textContent = err;
      showStatus(`Error: ${err}`, 'error', 4500);
      return false;
    }
  }
  return true;
}

async function save_options() {
  if (!validate()) return false;

  const positionData = positionStudio
    ? positionStudio.getData()
    : {
        defaultPosition: { ...DEFAULT_POSITION },
        sitePositions: createDefaultSitePositions(),
      };

  const posCheck = validateSitePositionEntries(positionData.sitePositions);
  if (!posCheck.valid) {
    showStatus(`Error in Controller Positioning: ${posCheck.error}`, 'error', 4000);
    return false;
  }

  try {
    const ok = await videoSpeedConfig.save({
      schemaVersion: 2,
      rememberSpeed: document.getElementById('rememberSpeed').checked,
      exclusiveKeys: document.getElementById('exclusiveKeys').checked,
      audioBoolean: document.getElementById('audioBoolean').checked,
      startHidden: document.getElementById('startHidden').checked,
      controllerOpacity: Number(document.getElementById('controllerOpacity').value),
      controllerButtonSize: Number(document.getElementById('controllerButtonSize').value),
      logLevel: parseInt(document.getElementById('logLevel').value, 10),
      defaultPosition: positionData.defaultPosition,
      sitePositions: positionData.sitePositions,
      keyBindings: collectKeyBindings(),
      siteRules: collectSiteRules(),
    });

    if (!ok) {
      showStatus('Error: Failed to save options to storage', 'error', 3500);
      return false;
    }

    showStatus('Options saved', 'success', 2000);
    return true;
  } catch (error) {
    showStatus(`Error saving options: ${error.message}`, 'error', 4000);
    return false;
  }
}

async function restore_options() {
  try {
    await videoSpeedConfig.load();
    const s = videoSpeedConfig.settings;

    document.getElementById('rememberSpeed').checked = s.rememberSpeed;
    document.getElementById('exclusiveKeys').checked = s.exclusiveKeys;
    document.getElementById('audioBoolean').checked = s.audioBoolean;
    document.getElementById('startHidden').checked = s.startHidden;
    document.getElementById('controllerOpacity').value = s.controllerOpacity;
    document.getElementById('controllerButtonSize').value = s.controllerButtonSize;
    document.getElementById('logLevel').value = s.logLevel;

    const rulesContainer = document.getElementById('site-rules-container');
    rulesContainer.querySelectorAll('.row.site-rule').forEach((r) => r.remove());
    for (const rule of s.siteRules || DEFAULT_SETTINGS.siteRules) {
      add_site_rule(rule);
    }

    const shortcutsContainer = document.getElementById('shortcuts-container');
    shortcutsContainer.innerHTML = '';
    for (const item of s.keyBindings || DEFAULT_SETTINGS.keyBindings) {
      if (item.predefined) {
        add_predefined_shortcut(item);
      } else {
        const row = add_shortcut({ action: item.action, value: item.value });
        setShortcutInput(row.querySelector('.customKey'), item);
      }
    }

    positionStudio?.setData({
      defaultPosition: s.defaultPosition,
      sitePositions: s.sitePositions,
    });
  } catch (error) {
    showStatus(`Error loading options: ${error.message}`, 'error', 3500);
  }
}

async function restore_defaults() {
  try {
    showStatus('Restoring defaults...', '', 0);
    await StorageManager.clear();
    const defaults = {
      ...DEFAULT_SETTINGS,
      defaultPosition: { ...DEFAULT_POSITION },
      sitePositions: createDefaultSitePositions(),
      keyBindings: DEFAULT_SETTINGS.keyBindings.map((k) => ({ ...k })),
      siteRules: DEFAULT_SETTINGS.siteRules.map((r) => ({ ...r })),
      schemaVersion: 2,
    };
    const ok = await videoSpeedConfig.save(defaults);
    if (!ok) throw new Error('Failed to write defaults');
    await restore_options();
    showStatus('Default options restored', 'success', 2000);
  } catch (error) {
    showStatus(`Error restoring defaults: ${error.message}`, 'error', 3500);
  }
}

async function export_settings() {
  try {
    await videoSpeedConfig.load();
    const data = await StorageManager.get(DEFAULT_SETTINGS);
    const json = JSON.stringify(data || videoSpeedConfig.settings, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vsc-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus('Settings exported', 'success', 2000);
  } catch (error) {
    showStatus(`Export failed: ${error.message}`, 'error', 3500);
  }
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = '';

  try {
    const imported = JSON.parse(await file.text());
    if (!imported || typeof imported !== 'object' || !Array.isArray(imported.keyBindings)) {
      throw new Error('File does not contain valid VSC settings');
    }
    await StorageManager.clear();
    const ok = await videoSpeedConfig.save({
      ...imported,
      defaultPosition: imported.defaultPosition ?? { ...DEFAULT_POSITION },
      sitePositions: Array.isArray(imported.sitePositions)
        ? imported.sitePositions
        : createDefaultSitePositions(),
    });
    if (!ok) throw new Error('Failed to write imported settings');
    await restore_options();
    showStatus('Settings imported successfully', 'success', 2500);
  } catch (error) {
    showStatus(`Import failed: ${error.message}`, 'error', 4000);
  }
}

function switchTab(tabName) {
  const normalized = tabName === 'faq' ? 'about' : tabName;
  for (const name of ['settings', 'advanced', 'about']) {
    document.getElementById(`tab-${name}`).classList.toggle('active', name === normalized);
    document.getElementById(`panel-${name}`).style.display = name === normalized ? '' : 'none';
  }
  if (normalized === 'advanced') {
    positionStudio?.renderPreview();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const versionEl = document.getElementById('about-version');
  const manifestVersion = chrome?.runtime?.getManifest?.()?.version;
  if (versionEl && manifestVersion) {
    versionEl.textContent = `v${manifestVersion}`;
  }

  const saveBtn = document.getElementById('save');
  const markDirty = () => {
    saveBtn.classList.add('has-changes');
    saveBtn.classList.remove('saved');
  };
  const markClean = () => {
    saveBtn.classList.remove('has-changes');
    saveBtn.classList.add('saved');
    setTimeout(() => saveBtn.classList.remove('saved'), 1500);
  };

  const posRoot = document.getElementById('controller-positioning');
  if (posRoot) {
    positionStudio = new PositionStudio(posRoot, { onDirty: markDirty });
  }

  await restore_options();

  const params = new URLSearchParams(location.search);
  const initialTab = params.get('tab');
  const targetSite = params.get('site');
  if (targetSite && positionStudio) {
    const matched = positionStudio.sitePositions.find(
      (entry) => entry.id === targetSite || entry.pattern.toLowerCase() === targetSite.toLowerCase()
    );
    if (matched) {
      positionStudio.selectedKey = matched.id;
      positionStudio.render();
    }
  }
  if (initialTab && ['settings', 'advanced', 'about', 'faq'].includes(initialTab)) {
    switchTab(initialTab);
  }

  window.addEventListener('resize', () => positionStudio?.renderPreview());

  document.body.addEventListener('input', markDirty);
  document.body.addEventListener('change', markDirty);

  saveBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const ok = await save_options();
    if (ok) markClean();
  });

  document.getElementById('add').addEventListener('click', () => {
    add_shortcut();
    markDirty();
  });
  document.getElementById('add-site-rule').addEventListener('click', () => {
    add_site_rule();
    markDirty();
  });

  document.getElementById('restore').addEventListener('click', async (e) => {
    e.preventDefault();
    await restore_defaults();
    markClean();
  });
  document.getElementById('export').addEventListener('click', (e) => {
    e.preventDefault();
    export_settings();
  });
  document.getElementById('import').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', handleImportFile);

  document.getElementById('tab-settings').addEventListener('click', () => switchTab('settings'));
  document.getElementById('tab-advanced').addEventListener('click', () => switchTab('advanced'));
  document.getElementById('tab-about').addEventListener('click', () => switchTab('about'));

  const splitMenu = document.getElementById('split-menu');
  document.getElementById('split-toggle').addEventListener('click', () => {
    splitMenu.hidden = !splitMenu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.split-button')) splitMenu.hidden = true;
  });
  splitMenu.addEventListener('click', () => {
    splitMenu.hidden = true;
  });

  document.addEventListener('beforeinput', (e) => {
    if (!e.target.classList?.contains('customValue')) return;
    if ((e.inputType === 'insertText' || e.inputType === 'insertFromPaste') && e.data) {
      if (!/^\d+(\.\d*)?$/.test(e.target.value + e.data)) e.preventDefault();
    }
  });

  document.addEventListener('focusin', (e) => {
    if (e.target.classList?.contains('customKey')) e.target.value = '';
  });

  document.addEventListener('focusout', (e) => {
    if (!e.target.classList?.contains('customKey')) return;
    if (e.target.code) {
      e.target.value = formatShortcutDisplay(
        e.target.displayKey || displayKeyFromCode(e.target.code),
        e.target.modifiers
      );
    } else if (e.target.code === null) {
      e.target.value = 'null';
    } else {
      const kc = e.target.keyCode;
      e.target.value =
        keyCodeAliases[kc] || (kc >= 48 && kc <= 90 ? String.fromCharCode(kc) : `Key ${kc}`);
    }
    autoSizeKeyInput(e.target);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.classList?.contains('customKey')) recordKeyPress(e);
  });

  document.addEventListener('click', (e) => {
    if (e.target.classList?.contains('removeParent')) {
      e.target.closest('.row')?.remove();
      markDirty();
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.classList?.contains('customDo')) {
      const row = e.target.closest('.row');
      const valueInput = row.querySelector('.customValue');
      if (CUSTOM_ACTIONS_NO_VALUES.includes(e.target.value)) {
        valueInput.style.display = 'none';
        valueInput.value = 0;
      } else {
        valueInput.style.display = 'inline-block';
      }
    }
  });
});


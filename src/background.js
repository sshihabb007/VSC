import {
  PREDEFINED_CODE_MAP,
  KEYCODE_TO_CODE,
  displayKeyFromCode,
  PREDEFINED_ACTIONS,
  DEFAULT_BINDINGS,
} from './utils/key-maps.js';

async function updateIcon(enabled) {
  try {
    const suffix = enabled ? '' : '_disabled';
    await chrome.action.setIcon({
      path: {
        19: `assets/icons/icon19${suffix}.png`,
        38: `assets/icons/icon38${suffix}.png`,
        48: `assets/icons/icon48${suffix}.png`,
      },
    });
  } catch (error) {
    console.error('[VSC] Failed to update action icon:', error);
  }
}

async function initializeIcon() {
  try {
    const storage = await chrome.storage.sync.get({ enabled: true });
    await updateIcon(storage.enabled !== false);
  } catch {
    await updateIcon(true);
  }
}

async function migrateConfig() {
  const DEPRECATED_KEYS = [
    'speeds',
    'version',
    'forceLastSavedSpeed',
    'resetSpeed',
    'speedStep',
    'fastSpeed',
    'rewindTime',
    'advanceTime',
    'resetKeyCode',
    'slowerKeyCode',
    'fasterKeyCode',
    'rewindKeyCode',
    'advanceKeyCode',
    'fastKeyCode',
    'displayKeyCode',
  ];
  try {
    await chrome.storage.sync.remove(DEPRECATED_KEYS);
  } catch (error) {
    console.error('[VSC] Config migration cleanup failed:', error);
  }
}

async function migrateKeyBindingsV2() {
  try {
    const storage = await chrome.storage.sync.get(null);
    const bindings = storage.keyBindings;
    if (!bindings || !Array.isArray(bindings) || bindings.length === 0) {
      return;
    }
    if (storage.schemaVersion === 2 && bindings.every((b) => b.code !== undefined)) {
      return;
    }

    const migrated = bindings.map((binding) => {
      if (binding.code !== undefined) return binding;
      const legacyKey = binding.key;

      if (binding.predefined && PREDEFINED_CODE_MAP[legacyKey]) {
        const mapped = PREDEFINED_CODE_MAP[legacyKey];
        return {
          ...binding,
          code: mapped.code,
          keyCode: legacyKey,
          displayKey: mapped.displayKey,
        };
      }

      const code = KEYCODE_TO_CODE[legacyKey];
      if (code) {
        return {
          ...binding,
          code,
          keyCode: legacyKey,
          displayKey: displayKeyFromCode(code),
        };
      }

      return {
        ...binding,
        code: null,
        keyCode: legacyKey,
        displayKey: '',
      };
    });

    const existingActions = new Set(migrated.map((b) => b.action));
    for (const action of PREDEFINED_ACTIONS) {
      if (!existingActions.has(action)) {
        migrated.push({
          action,
          ...DEFAULT_BINDINGS[action],
          predefined: true,
        });
      }
    }

    await chrome.storage.sync.set({
      keyBindings: migrated,
      schemaVersion: 2,
    });
  } catch (error) {
    console.error('[VSC] Key binding v2 migration failed:', error);
  }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.enabled) {
    updateIcon(changes.enabled.newValue !== false);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await migrateConfig();
  await migrateKeyBindingsV2();
  await initializeIcon();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeIcon();
});

initializeIcon();


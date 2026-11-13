import { logger } from '../utils/logger.js';

const SETTINGS_TIMEOUT_MS = 2000;

export class StorageManager {
  static hasChromeStorage() {
    return typeof chrome !== 'undefined' && !!chrome.storage?.sync;
  }

  static async get(defaults = {}) {
    if (this.hasChromeStorage()) {
      return await chrome.storage.sync.get(defaults);
    }

    // MAIN world path: request snapshot once from ISOLATED bridge.
    return await new Promise((resolve) => {
      const docEl = document.documentElement;
      if (!docEl) {
        resolve(null);
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        docEl.removeEventListener('VSC_SETTINGS_READY', onReady);
        logger.warn('Timed out waiting for VSC_SETTINGS_READY; aborting fail-closed');
        resolve(null);
      }, SETTINGS_TIMEOUT_MS);

      const onReady = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const detail = event?.detail;
        if (!detail || detail.abort || !detail.settings || typeof detail.settings !== 'object') {
          resolve(null);
          return;
        }
        resolve({ ...defaults, ...detail.settings });
      };

      docEl.addEventListener('VSC_SETTINGS_READY', onReady, { once: true });
      docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
    });
  }

  static async set(items) {
    if (this.hasChromeStorage()) {
      await chrome.storage.sync.set(items);
      return true;
    }

    // MAIN world only bridges lastSpeed mutations back to extension storage.
    if (items && typeof items === 'object' && 'lastSpeed' in items) {
      document.documentElement?.dispatchEvent(
        new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: items.lastSpeed } })
      );
      return true;
    }
    return false;
  }

  static async remove(keys) {
    if (this.hasChromeStorage()) {
      await chrome.storage.sync.remove(keys);
      return true;
    }
    return false;
  }

  static async clear() {
    if (this.hasChromeStorage()) {
      await chrome.storage.sync.clear();
      return true;
    }
    return false;
  }

  static onChanged(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      const listener = (changes, namespace) => {
        if (namespace === 'sync') callback(changes);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }

    const docEl = document.documentElement;
    if (!docEl) return () => {};
    const handler = (event) => {
      if (event?.detail && typeof event.detail === 'object') {
        callback(event.detail);
      }
    };
    docEl.addEventListener('VSC_STORAGE_CHANGED', handler);
    return () => docEl.removeEventListener('VSC_STORAGE_CHANGED', handler);
  }
}


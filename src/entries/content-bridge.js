import { isBlacklisted } from '../utils/blacklist.js';
import { matchSiteRule } from '../utils/site-pattern.js';

const SPEED_MIN = 0.07;
const SPEED_MAX = 16;

const docEl = document.documentElement;
let bridgeInitialized = false;

function isContextInvalidated(error) {
  return Boolean(error?.message?.includes('Extension context invalidated'));
}

function dispatchAbort() {
  docEl.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail: { abort: true } }));
}

function init() {
  try {
    if (bridgeInitialized || !docEl) return;
    bridgeInitialized = true;

    // Inherited about: frames fail closed to enforce disabled-site policies.
    if (location.protocol === 'about:') {
      docEl.addEventListener('VSC_REQUEST_SETTINGS', dispatchAbort, { once: true });
      return;
    }

    let disabledForDocument = false;
    let bridgeActive = false;

    const settingsReady = chrome.storage.sync.get(null).catch((error) => {
      if (!isContextInvalidated(error)) {
        console.error('[VSC] Initial settings load failed:', error);
      }
      return null;
    });

    docEl.addEventListener(
      'VSC_REQUEST_SETTINGS',
      async () => {
        const settings = await settingsReady;
        if (!settings) {
          dispatchAbort();
          return;
        }

        const blacklisted = !settings.siteRules && isBlacklisted(settings.blacklist, location.href);
        const siteRuleMatch = matchSiteRule(settings.siteRules, location.href);
        const siteDisabled = siteRuleMatch && siteRuleMatch.enabled === false;
        if (disabledForDocument || settings.enabled === false || blacklisted || siteDisabled) {
          dispatchAbort();
          return;
        }

        const publicSettings = { ...settings };
        delete publicSettings.blacklist;
        delete publicSettings.enabled;
        bridgeActive = true;
        docEl.dispatchEvent(
          new CustomEvent('VSC_SETTINGS_READY', {
            detail: {
              settings: publicSettings,
              hostname: location.hostname.replace(/^www\./, ''),
            },
          })
        );
      },
      { once: true }
    );

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') return;

      const enabledChange = changes.enabled;
      if (enabledChange?.oldValue === false || enabledChange?.newValue === false) {
        disabledForDocument = true;
      }
      if (enabledChange?.newValue === false) {
        bridgeActive = false;
        docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_TEARDOWN' } }));
        return;
      }
      if (!bridgeActive) return;

      const relayChanges = { ...changes };
      delete relayChanges.enabled;
      delete relayChanges.blacklist;
      if (Object.keys(relayChanges).length > 0) {
        docEl.dispatchEvent(new CustomEvent('VSC_STORAGE_CHANGED', { detail: relayChanges }));
      }
    });

    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request?.type === 'VSC_QUERY_HOST') {
        if (window === window.top) {
          sendResponse({
            url: location.href,
            hostname: location.hostname.replace(/^www\./i, ''),
          });
        }
        return false;
      }

      if (!bridgeActive) return;
      if (request?.type === 'VSC_QUERY_STATE') {
        let reply = null;
        const onReply = (e) => {
          reply = e.detail;
        };
        docEl.addEventListener('VSC_STATE_REPLY', onReply, { once: true });
        docEl.dispatchEvent(new CustomEvent('VSC_QUERY_STATE'));
        docEl.removeEventListener('VSC_STATE_REPLY', onReply);
        if (reply && reply.count > 0) {
          sendResponse(reply);
        }
        return false;
      }

      docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: request }));
    });

    const handleWriteStorage = (e) => {
      try {
        if (!bridgeActive) return;
        const data = e.detail;
        if (!data || typeof data !== 'object') return;
        if ('lastSpeed' in data) {
          const speed = data.lastSpeed;
          if (typeof speed === 'number' && Number.isFinite(speed)) {
            chrome.storage.sync
              .set({
                lastSpeed: Math.min(Math.max(speed, SPEED_MIN), SPEED_MAX),
              })
              .catch((err) => {
                if (isContextInvalidated(err)) {
                  docEl.removeEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
                }
              });
          }
        }
      } catch (err) {
        if (isContextInvalidated(err)) {
          docEl.removeEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
        }
      }
    };
    docEl.addEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
  } catch (error) {
    if (!isContextInvalidated(error)) {
      console.error('[VSC] Bridge init failed:', error);
    }
  }
}

init();


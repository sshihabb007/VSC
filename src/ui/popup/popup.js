import {
  POSITION_ANCHORS,
  DEFAULT_POSITION,
  createDefaultSitePositions,
  ensureBuiltinPlatformPresets,
  findMatchingSitePosition,
  normalizePosition,
  normalizeSitePatternInput,
  normalizeSitePositionEntry,
  normalizeSitePositions,
  nudgePosition,
} from '../../core/position.js';
import { DEFAULT_BINDINGS } from '../../utils/key-maps.js';

const MessageTypes = {
  SET_SPEED: 'VSC_SET_SPEED',
  ADJUST_SPEED: 'VSC_ADJUST_SPEED',
  RESET_SPEED: 'VSC_RESET_SPEED',
  TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY',
  QUERY_STATE: 'VSC_QUERY_STATE',
  QUERY_HOST: 'VSC_QUERY_HOST',
};

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status');
  const liveBadge = document.getElementById('live-speed');
  const disableBtn = document.getElementById('disable');
  const decreaseBtn = document.getElementById('speed-decrease');
  const increaseBtn = document.getElementById('speed-increase');
  const resetBtn = document.getElementById('speed-reset');
  const presetBtns = Array.from(document.querySelectorAll('.preset-btn'));

  const scopeSelect = document.getElementById('pos-scope-select');
  const openStudioBtn = document.getElementById('pos-open-studio');
  const resetPosBtn = document.getElementById('popup-pos-reset');
  const posReadoutEl = document.getElementById('popup-pos-readout');
  const anchorBtns = Array.from(document.querySelectorAll('.mini-pos-btn[data-anchor]'));
  const nudgeBtns = Array.from(document.querySelectorAll('.mini-nudge-btn[data-nudge]'));

  let activeTabId = null;
  let detectedPageUrl = '';
  let detectedHostname = '';
  let scopeTouchedByUser = false;
  let selectedScopeKey = '__default__';

  let defaultPosition = normalizePosition(DEFAULT_POSITION);
  let sitePositions = createDefaultSitePositions();
  let storageLoaded = false;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    activeTabId = tabs?.[0]?.id ?? null;
    queryActiveTabState();
  });

  function sendTabCommand(msg, onReply) {
    const dispatch = (tabId) => {
      if (tabId == null) return;
      try {
        chrome.tabs.sendMessage(tabId, msg, (res) => {
          void chrome.runtime.lastError;
          if (onReply) onReply(res);
        });
      } catch {
        // Tab has no content script (chrome://, Web Store, etc.)
      }
    };
    if (activeTabId !== null) {
      dispatch(activeTabId);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        activeTabId = tabs?.[0]?.id ?? null;
        dispatch(activeTabId);
      });
    }
  }

  function applyDetectedHost(url, hostname) {
    if (!url || !hostname) return;
    detectedPageUrl = url;
    detectedHostname = normalizeSitePatternInput(hostname);
    if (!scopeTouchedByUser && storageLoaded) {
      autoSelectDetectedScope();
      renderPositionUI();
    }
  }

  function queryActiveTabState() {
    sendTabCommand({ type: MessageTypes.QUERY_STATE }, (reply) => {
      if (reply && typeof reply.speed === 'number') {
        renderLiveSpeed(reply.speed, reply.count);
      }
      if (reply?.url && reply?.hostname) {
        applyDetectedHost(reply.url, reply.hostname);
      } else if (!detectedHostname) {
        sendTabCommand({ type: MessageTypes.QUERY_HOST }, (hostReply) => {
          if (hostReply?.url && hostReply?.hostname) {
            applyDetectedHost(hostReply.url, hostReply.hostname);
          }
        });
      }
    });
  }

  function autoSelectDetectedScope() {
    if (!detectedPageUrl && !detectedHostname) {
      selectedScopeKey = '__default__';
      return;
    }
    const matched = findMatchingSitePosition(sitePositions, detectedPageUrl || detectedHostname);
    if (matched) {
      selectedScopeKey = matched.id;
    } else if (detectedHostname) {
      selectedScopeKey = '__current_host__';
    } else {
      selectedScopeKey = '__default__';
    }
  }

  function renderLiveSpeed(speed, count = 1) {
    if (typeof speed !== 'number' || !Number.isFinite(speed)) return;
    const formatted = speed.toFixed(2);
    liveBadge.textContent = count > 1 ? `${formatted}× (${count})` : `${formatted}×`;
    liveBadge.classList.add('active');
    for (const btn of presetBtns) {
      const presetVal = parseFloat(btn.dataset.speed);
      btn.classList.toggle('is-current', Math.abs(presetVal - speed) < 0.005);
    }
  }

  function getActiveScopePosition() {
    if (selectedScopeKey === '__default__') {
      return normalizePosition(defaultPosition);
    }
    if (selectedScopeKey === '__current_host__') {
      const matched = findMatchingSitePosition(sitePositions, detectedPageUrl || detectedHostname);
      return normalizePosition(matched || defaultPosition);
    }
    const found = sitePositions.find((entry) => entry.id === selectedScopeKey);
    return normalizePosition(found || defaultPosition);
  }

  function renderScopeSelect() {
    if (!scopeSelect) return;
    scopeSelect.textContent = '';

    const unmatchedHost =
      detectedHostname &&
      !findMatchingSitePosition(sitePositions, detectedPageUrl || detectedHostname);

    if (unmatchedHost) {
      const opt = document.createElement('option');
      opt.value = '__current_host__';
      opt.textContent = `This site (${detectedHostname})`;
      scopeSelect.appendChild(opt);
    }

    const defOpt = document.createElement('option');
    defOpt.value = '__default__';
    defOpt.textContent = 'Global Default';
    scopeSelect.appendChild(defOpt);

    for (const entry of sitePositions) {
      const opt = document.createElement('option');
      opt.value = entry.id;
      opt.textContent = entry.label;
      scopeSelect.appendChild(opt);
    }

    const hasSelected = Array.from(scopeSelect.options).some(
      (o) => o.value === selectedScopeKey
    );
    scopeSelect.value = hasSelected ? selectedScopeKey : '__default__';
    selectedScopeKey = scopeSelect.value;
  }

  function renderPositionUI() {
    renderScopeSelect();
    const pos = getActiveScopePosition();
    for (const btn of anchorBtns) {
      btn.classList.toggle('active', btn.dataset.anchor === pos.anchor);
    }
    if (posReadoutEl) {
      const label = POSITION_ANCHORS[pos.anchor]?.label || pos.anchor;
      posReadoutEl.textContent = `${label} · ${pos.offsetX},${pos.offsetY}px`;
    }
  }

  function commitPositionUpdate(mutator) {
    if (!storageLoaded) return;

    if (selectedScopeKey === '__current_host__' && detectedHostname) {
      const pattern = normalizeSitePatternInput(detectedHostname);
      const base = normalizePosition(defaultPosition);
      const next = normalizePosition(mutator(base));
      const created = normalizeSitePositionEntry(
        {
          id: `custom-${Date.now().toString(36)}`,
          pattern,
          anchor: next.anchor,
          offsetX: next.offsetX,
          offsetY: next.offsetY,
          builtin: false,
          enabled: true,
        },
        sitePositions.length
      );
      if (created) {
        sitePositions.push(created);
        selectedScopeKey = created.id;
      }
    } else if (selectedScopeKey === '__default__') {
      defaultPosition = normalizePosition(mutator(defaultPosition));
    } else {
      const target = sitePositions.find((entry) => entry.id === selectedScopeKey);
      if (target) {
        const next = normalizePosition(mutator(target));
        target.anchor = next.anchor;
        target.offsetX = next.offsetX;
        target.offsetY = next.offsetY;
      } else {
        defaultPosition = normalizePosition(mutator(defaultPosition));
      }
    }

    chrome.storage.sync.set({ defaultPosition, sitePositions });
    renderPositionUI();
  }

  function toggleEnabledUI(enabled) {
    disableBtn.classList.toggle('disabled', !enabled);
    disableBtn.title = enabled ? 'Disable Extension' : 'Enable Extension';
  }

  function setStatusMessage(str) {
    statusEl.classList.remove('hide');
    statusEl.textContent = str;
  }

  document.getElementById('config').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  openStudioBtn?.addEventListener('click', () => {
    const query = new URLSearchParams({ tab: 'advanced' });
    if (selectedScopeKey && selectedScopeKey !== '__default__' && selectedScopeKey !== '__current_host__') {
      query.set('site', selectedScopeKey);
    }
    chrome.tabs.create({ url: chrome.runtime.getURL(`ui/options/options.html?${query.toString()}`) });
  });

  scopeSelect?.addEventListener('change', () => {
    scopeTouchedByUser = true;
    selectedScopeKey = scopeSelect.value;
    renderPositionUI();
  });

  for (const btn of anchorBtns) {
    btn.addEventListener('click', () => {
      commitPositionUpdate((prev) => ({ ...prev, anchor: btn.dataset.anchor }));
    });
  }

  for (const btn of nudgeBtns) {
    btn.addEventListener('click', () => {
      commitPositionUpdate((prev) => nudgePosition(prev, btn.dataset.nudge, 10));
    });
  }

  resetPosBtn?.addEventListener('click', () => {
    commitPositionUpdate(() => ({ ...DEFAULT_POSITION }));
  });

  document.getElementById('toggle-overlay').addEventListener('click', () => {
    sendTabCommand({ type: MessageTypes.TOGGLE_DISPLAY });
  });

  disableBtn.addEventListener('click', () => {
    const nextEnabled = disableBtn.classList.contains('disabled');
    chrome.storage.sync.set({ enabled: nextEnabled }, () => {
      toggleEnabledUI(nextEnabled);
      setStatusMessage(`${nextEnabled ? 'Enabled' : 'Disabled'}. Reload page.`);
    });
  });

  chrome.storage.sync.get(
    {
      enabled: true,
      keyBindings: null,
      defaultPosition: DEFAULT_POSITION,
      sitePositions: null,
    },
    (storage) => {
      toggleEnabledUI(storage.enabled !== false);

      let slowerStep = DEFAULT_BINDINGS.slower.value;
      let fasterStep = DEFAULT_BINDINGS.faster.value;
      let resetSpeed = DEFAULT_BINDINGS.fast.value;

      if (Array.isArray(storage.keyBindings)) {
        for (const kb of storage.keyBindings) {
          if (kb.action === 'slower' && typeof kb.value === 'number') slowerStep = kb.value;
          else if (kb.action === 'faster' && typeof kb.value === 'number') fasterStep = kb.value;
          else if (kb.action === 'fast' && typeof kb.value === 'number') resetSpeed = kb.value;
        }
      }

      decreaseBtn.dataset.delta = String(-slowerStep);
      decreaseBtn.querySelector('span').textContent = `-${slowerStep}`;
      increaseBtn.dataset.delta = String(fasterStep);
      increaseBtn.querySelector('span').textContent = `+${fasterStep}`;
      resetBtn.textContent = String(resetSpeed);

      defaultPosition = normalizePosition(storage.defaultPosition);
      sitePositions = Array.isArray(storage.sitePositions)
        ? ensureBuiltinPlatformPresets(normalizeSitePositions(storage.sitePositions))
        : createDefaultSitePositions();
      storageLoaded = true;
      autoSelectDetectedScope();
      renderPositionUI();
    }
  );

  decreaseBtn.addEventListener('click', () => {
    const delta = parseFloat(decreaseBtn.dataset.delta);
    sendTabCommand({ type: MessageTypes.ADJUST_SPEED, payload: { delta } });
    setTimeout(queryActiveTabState, 40);
  });

  increaseBtn.addEventListener('click', () => {
    const delta = parseFloat(increaseBtn.dataset.delta);
    sendTabCommand({ type: MessageTypes.ADJUST_SPEED, payload: { delta } });
    setTimeout(queryActiveTabState, 40);
  });

  resetBtn.addEventListener('click', () => {
    const preferredSpeed = parseFloat(resetBtn.textContent);
    sendTabCommand({ type: MessageTypes.SET_SPEED, payload: { speed: preferredSpeed } });
    renderLiveSpeed(preferredSpeed);
  });

  for (const btn of presetBtns) {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.dataset.speed);
      sendTabCommand({ type: MessageTypes.SET_SPEED, payload: { speed } });
      renderLiveSpeed(speed);
    });
  }
});

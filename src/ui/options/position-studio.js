import {
  POSITION_ANCHORS,
  POSITION_ANCHOR_ORDER,
  DEFAULT_POSITION,
  createDefaultSitePositions,
  ensureBuiltinPlatformPresets,
  normalizePosition,
  normalizeSitePatternInput,
  normalizeSitePositionEntry,
  nudgePosition,
  computeAnchorCoordinates,
} from '../../core/position.js';
import { validateSitePattern } from '../../utils/site-pattern.js';

const ANCHOR_ICONS = Object.freeze({
  'top-left': '↖',
  top: '↑',
  'top-right': '↗',
  left: '←',
  right: '→',
  'bottom-left': '↙',
  bottom: '↓',
  'bottom-right': '↘',
});

const VIRTUAL_VIDEO_WIDTH = 720;

export class PositionStudio {
  constructor(root, { onDirty = () => {} } = {}) {
    this.root = root;
    this.onDirty = onDirty;

    this.defaultPosition = normalizePosition(DEFAULT_POSITION);
    this.sitePositions = createDefaultSitePositions();
    this.selectedKey = '__default__';
    this.nudgeStep = 10;

    this.platformTabsEl = root.querySelector('#pos-platform-tabs');
    this.sitePatternInput = root.querySelector('#pos-site-pattern');
    this.addSiteBtn = root.querySelector('#pos-add-site');
    this.siteErrorEl = root.querySelector('#pos-site-error');
    this.scopeSummaryEl = root.querySelector('#pos-scope-summary');
    this.stageEl = root.querySelector('#pos-preview-stage');
    this.previewBadgeEl = root.querySelector('#pos-preview-badge');
    this.readoutEl = root.querySelector('#pos-readout');
    this.offsetXInput = root.querySelector('#pos-offset-x');
    this.offsetYInput = root.querySelector('#pos-offset-y');
    this.resetCurrentBtn = root.querySelector('#pos-reset-current');
    this.centerResetBtn = root.querySelector('#pos-reset-offsets');

    this.anchorBtns = Array.from(root.querySelectorAll('[data-anchor]'));
    this.nudgeBtns = Array.from(root.querySelectorAll('[data-nudge]'));
    this.stepBtns = Array.from(root.querySelectorAll('[data-step]'));

    this.bindEvents();
    this.render();
  }

  bindEvents() {
    this.platformTabsEl?.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('[data-remove-site]');
      if (removeBtn) {
        e.stopPropagation();
        this.removeCustomSite(removeBtn.dataset.removeSite);
        return;
      }
      const tabBtn = e.target.closest('[data-site-key]');
      if (tabBtn) {
        this.selectedKey = tabBtn.dataset.siteKey;
        this.clearSiteError();
        this.render();
      }
    });

    this.addSiteBtn?.addEventListener('click', () => this.handleAddSite());
    this.sitePatternInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleAddSite();
      }
    });
    this.sitePatternInput?.addEventListener('input', () => this.clearSiteError());

    for (const btn of this.anchorBtns) {
      btn.addEventListener('click', () => {
        this.updateActivePosition({ anchor: btn.dataset.anchor });
      });
    }

    for (const btn of this.nudgeBtns) {
      btn.addEventListener('click', () => {
        const next = nudgePosition(this.getActivePosition(), btn.dataset.nudge, this.nudgeStep);
        this.updateActivePosition(next);
      });
    }

    for (const btn of this.stepBtns) {
      btn.addEventListener('click', () => {
        const stepVal = Number(btn.dataset.step);
        if (Number.isFinite(stepVal) && stepVal > 0) {
          this.nudgeStep = stepVal;
          this.renderControlsState();
        }
      });
    }

    const onOffsetInput = () => {
      const x = Number(this.offsetXInput?.value);
      const y = Number(this.offsetYInput?.value);
      this.updateActivePosition({
        offsetX: Number.isFinite(x) ? x : 0,
        offsetY: Number.isFinite(y) ? y : 0,
      });
    };
    this.offsetXInput?.addEventListener('input', onOffsetInput);
    this.offsetYInput?.addEventListener('input', onOffsetInput);

    this.centerResetBtn?.addEventListener('click', () => {
      this.updateActivePosition({ offsetX: 0, offsetY: 0 });
    });

    this.resetCurrentBtn?.addEventListener('click', () => {
      this.updateActivePosition({ ...DEFAULT_POSITION });
    });
  }

  setData({ defaultPosition, sitePositions } = {}) {
    this.defaultPosition = normalizePosition(defaultPosition);
    this.sitePositions = Array.isArray(sitePositions)
      ? ensureBuiltinPlatformPresets(sitePositions)
      : createDefaultSitePositions();

    const stillExists =
      this.selectedKey === '__default__' ||
      this.sitePositions.some((entry) => entry.id === this.selectedKey);
    if (!stillExists) {
      this.selectedKey = '__default__';
    }
    this.clearSiteError();
    this.render();
  }

  getData() {
    return {
      defaultPosition: normalizePosition(this.defaultPosition),
      sitePositions: this.sitePositions.map((entry, idx) =>
        normalizeSitePositionEntry(entry, idx)
      ).filter(Boolean),
    };
  }

  getActiveEntry() {
    if (this.selectedKey === '__default__') return null;
    return this.sitePositions.find((entry) => entry.id === this.selectedKey) || null;
  }

  getActivePosition() {
    const active = this.getActiveEntry();
    return normalizePosition(active || this.defaultPosition);
  }

  updateActivePosition(patch) {
    const current = this.getActivePosition();
    const next = normalizePosition({ ...current, ...patch });
    const active = this.getActiveEntry();
    if (active) {
      active.anchor = next.anchor;
      active.offsetX = next.offsetX;
      active.offsetY = next.offsetY;
    } else {
      this.defaultPosition = next;
    }
    this.onDirty();
    this.render();
  }

  handleAddSite() {
    const raw = this.sitePatternInput?.value ?? '';
    const pattern = normalizeSitePatternInput(raw);
    const check = validateSitePattern(pattern);
    if (!check.valid) {
      this.showSiteError(check.error || 'Enter a valid domain (e.g. twitch.tv) or /regex/');
      return;
    }

    const existing = this.sitePositions.find(
      (entry) => entry.pattern.toLowerCase() === pattern.toLowerCase()
    );
    if (existing) {
      this.selectedKey = existing.id;
      this.sitePatternInput.value = '';
      this.clearSiteError();
      this.render();
      return;
    }

    const active = this.getActivePosition();
    const created = normalizeSitePositionEntry(
      {
        id: `custom-${Date.now().toString(36)}`,
        pattern,
        anchor: active.anchor,
        offsetX: active.offsetX,
        offsetY: active.offsetY,
        builtin: false,
        enabled: true,
      },
      this.sitePositions.length
    );

    if (!created) {
      this.showSiteError('Could not create site position rule.');
      return;
    }

    this.sitePositions.push(created);
    this.selectedKey = created.id;
    this.sitePatternInput.value = '';
    this.clearSiteError();
    this.onDirty();
    this.render();
  }

  removeCustomSite(id) {
    const idx = this.sitePositions.findIndex((entry) => entry.id === id && !entry.builtin);
    if (idx === -1) return;
    this.sitePositions.splice(idx, 1);
    if (this.selectedKey === id) {
      this.selectedKey = '__default__';
    }
    this.onDirty();
    this.render();
  }

  showSiteError(message) {
    if (!this.siteErrorEl) return;
    this.siteErrorEl.textContent = message;
    this.siteErrorEl.hidden = false;
  }

  clearSiteError() {
    if (!this.siteErrorEl) return;
    this.siteErrorEl.textContent = '';
    this.siteErrorEl.hidden = true;
  }

  isCustomized(pos) {
    const p = normalizePosition(pos);
    return (
      p.anchor !== DEFAULT_POSITION.anchor ||
      p.offsetX !== DEFAULT_POSITION.offsetX ||
      p.offsetY !== DEFAULT_POSITION.offsetY
    );
  }

  render() {
    this.renderPlatformTabs();
    this.renderControlsState();
    this.renderPreview();
  }

  renderPlatformTabs() {
    if (!this.platformTabsEl) return;
    this.platformTabsEl.textContent = '';

    const items = [
      {
        id: '__default__',
        label: 'Global Default',
        pattern: '*',
        builtin: true,
        isDefault: true,
        pos: this.defaultPosition,
      },
      ...this.sitePositions.map((entry) => ({
        ...entry,
        isDefault: false,
        pos: entry,
      })),
    ];

    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pos-site-pill';
      if (item.id === this.selectedKey) {
        btn.classList.add('active');
      }
      if (this.isCustomized(item.pos)) {
        btn.classList.add('customized');
      }
      btn.dataset.siteKey = item.id;
      btn.title = item.isDefault
        ? 'Fallback position for all other sites'
        : `Pattern: ${item.pattern}`;

      const dot = document.createElement('span');
      dot.className = 'pos-pill-dot';
      dot.setAttribute('aria-hidden', 'true');
      btn.appendChild(dot);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'pos-pill-label';
      labelSpan.textContent = item.label;
      btn.appendChild(labelSpan);

      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'pos-pill-anchor';
      badgeSpan.textContent = ANCHOR_ICONS[normalizePosition(item.pos).anchor] || '↖';
      btn.appendChild(badgeSpan);

      if (!item.builtin && !item.isDefault) {
        const remove = document.createElement('span');
        remove.className = 'pos-pill-remove';
        remove.dataset.removeSite = item.id;
        remove.setAttribute('role', 'button');
        remove.setAttribute('aria-label', `Remove ${item.label}`);
        remove.textContent = '×';
        btn.appendChild(remove);
      }

      this.platformTabsEl.appendChild(btn);
    }

    if (this.scopeSummaryEl) {
      const active = this.getActiveEntry();
      this.scopeSummaryEl.textContent = active
        ? `Editing: ${active.label} (${active.pattern})`
        : 'Editing: Global Default (applied to all unmatched websites)';
    }
  }

  renderControlsState() {
    const pos = this.getActivePosition();

    for (const btn of this.anchorBtns) {
      const isSelected = btn.dataset.anchor === pos.anchor;
      btn.classList.toggle('active', isSelected);
      btn.setAttribute('aria-pressed', String(isSelected));
    }

    for (const btn of this.stepBtns) {
      const active = Number(btn.dataset.step) === this.nudgeStep;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    if (this.offsetXInput && document.activeElement !== this.offsetXInput) {
      this.offsetXInput.value = String(pos.offsetX);
    }
    if (this.offsetYInput && document.activeElement !== this.offsetYInput) {
      this.offsetYInput.value = String(pos.offsetY);
    }
  }

  renderPreview() {
    if (!this.stageEl || !this.previewBadgeEl) return;
    const pos = this.getActivePosition();
    const width = this.stageEl.clientWidth || 340;
    const height = this.stageEl.clientHeight || Math.round((width * 9) / 16);
    const scale = width / VIRTUAL_VIDEO_WIDTH;

    const scaledPos = {
      anchor: pos.anchor,
      offsetX: Math.round(pos.offsetX * scale),
      offsetY: Math.round(pos.offsetY * scale),
    };

    const coords = computeAnchorCoordinates(
      { left: 0, top: 0, width, height },
      { left: 0, top: 0, width, height },
      scaledPos,
      10
    );

    if (coords) {
      this.previewBadgeEl.style.left = coords.anchorX;
      this.previewBadgeEl.style.top = coords.anchorY;
      this.previewBadgeEl.style.transform = `translate3d(${coords.alignX}, ${coords.alignY}, 0)`;
    }

    if (this.readoutEl) {
      const anchorLabel = POSITION_ANCHORS[pos.anchor]?.label || pos.anchor;
      const signX = pos.offsetX > 0 ? `+${pos.offsetX}` : String(pos.offsetX);
      const signY = pos.offsetY > 0 ? `+${pos.offsetY}` : String(pos.offsetY);
      this.readoutEl.textContent = `${anchorLabel} · X: ${signX}px · Y: ${signY}px`;
    }
  }
}

export { POSITION_ANCHOR_ORDER };


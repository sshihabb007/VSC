import {
  POSITION_ANCHORS,
  POSITION_ANCHOR_ORDER,
  DEFAULT_POSITION,
  BUILTIN_PLATFORM_PRESETS,
} from '../utils/constants.js';
import { matchSiteRule, validateSitePattern } from '../utils/site-pattern.js';

export const CONTROLLER_EDGE_PADDING = 12;
export const MIN_POSITION_OFFSET = -2000;
export const MAX_POSITION_OFFSET = 2000;

export {
  POSITION_ANCHORS,
  POSITION_ANCHOR_ORDER,
  DEFAULT_POSITION,
  BUILTIN_PLATFORM_PRESETS,
};

export function createDefaultSitePositions() {
  return BUILTIN_PLATFORM_PRESETS.map((preset) => ({ ...preset }));
}

export function getDefaultPositionForSite(idOrPattern) {
  if (idOrPattern && idOrPattern !== '__default__') {
    const needle = String(idOrPattern).toLowerCase();
    const preset = BUILTIN_PLATFORM_PRESETS.find(
      (p) => p.id === idOrPattern || p.pattern.toLowerCase() === needle
    );
    if (preset) {
      return {
        anchor: preset.anchor,
        offsetX: preset.offsetX,
        offsetY: preset.offsetY,
      };
    }
  }
  return { ...DEFAULT_POSITION };
}

export function normalizeAnchor(anchor, fallback = DEFAULT_POSITION.anchor) {
  if (typeof anchor === 'string' && Object.hasOwn(POSITION_ANCHORS, anchor)) {
    return anchor;
  }
  return fallback;
}

export function normalizeOffset(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const rounded = Math.round(numeric);
  return Math.max(MIN_POSITION_OFFSET, Math.min(MAX_POSITION_OFFSET, rounded));
}

export function normalizePosition(position, fallback = DEFAULT_POSITION) {
  if (!position || typeof position !== 'object') {
    return {
      anchor: fallback.anchor,
      offsetX: fallback.offsetX,
      offsetY: fallback.offsetY,
    };
  }
  return {
    anchor: normalizeAnchor(position.anchor, fallback.anchor),
    offsetX: normalizeOffset(position.offsetX, fallback.offsetX),
    offsetY: normalizeOffset(position.offsetY, fallback.offsetY),
  };
}

/**
 * Normalizes a pasted URL or domain input into a clean site rule pattern
 * unless it is already an explicit `/regex/flags` pattern.
 */
export function normalizeSitePatternInput(rawInput) {
  const trimmed = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return trimmed;
    }
  }
  return trimmed.replace(/^www\./i, '').split('/')[0].toLowerCase();
}

export function deriveSiteLabel(pattern, explicitLabel) {
  if (typeof explicitLabel === 'string' && explicitLabel.trim()) {
    return explicitLabel.trim();
  }
  const raw = String(pattern || '').trim();
  if (!raw) return 'Custom Site';
  return raw.replace(/^www\./i, '');
}

export function normalizeSitePositionEntry(entry, index = 0) {
  if (!entry || typeof entry !== 'object') return null;
  const pattern = typeof entry.pattern === 'string' ? entry.pattern.trim() : '';
  if (!pattern) return null;

  const builtinMatch = BUILTIN_PLATFORM_PRESETS.find(
    (preset) => preset.id === entry.id || preset.pattern === pattern
  );
  const normalizedPos = normalizePosition(entry, builtinMatch || DEFAULT_POSITION);

  return {
    id:
      typeof entry.id === 'string' && entry.id.trim()
        ? entry.id.trim()
        : builtinMatch?.id || `site-${index}-${pattern.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label: deriveSiteLabel(pattern, entry.label || builtinMatch?.label),
    pattern,
    anchor: normalizedPos.anchor,
    offsetX: normalizedPos.offsetX,
    offsetY: normalizedPos.offsetY,
    builtin: Boolean(entry.builtin || builtinMatch),
    enabled: entry.enabled !== false,
  };
}

export function normalizeSitePositions(sitePositions, { seedDefaults = false } = {}) {
  const source = Array.isArray(sitePositions)
    ? sitePositions
    : seedDefaults
      ? createDefaultSitePositions()
      : [];

  const normalized = [];
  const seenPatterns = new Set();

  for (let i = 0; i < source.length; i++) {
    const entry = normalizeSitePositionEntry(source[i], i);
    if (!entry) continue;
    const key = entry.pattern.toLowerCase();
    if (seenPatterns.has(key)) continue;
    seenPatterns.add(key);
    normalized.push(entry);
  }

  return normalized;
}

export function ensureBuiltinPlatformPresets(sitePositions) {
  const existing = normalizeSitePositions(sitePositions);
  const byIdOrPattern = new Map();
  for (const item of existing) {
    byIdOrPattern.set(item.pattern.toLowerCase(), item);
    if (item.id) byIdOrPattern.set(`id:${item.id}`, item);
  }

  const missingBuiltins = [];
  for (const preset of BUILTIN_PLATFORM_PRESETS) {
    const hasMatch =
      byIdOrPattern.has(`id:${preset.id}`) ||
      byIdOrPattern.has(preset.pattern.toLowerCase());
    if (!hasMatch) {
      missingBuiltins.push({ ...preset });
    }
  }
  return [...missingBuiltins, ...existing];
}

export function findMatchingSitePosition(sitePositions, url) {
  if (!url || !Array.isArray(sitePositions) || sitePositions.length === 0) {
    return null;
  }
  return matchSiteRule(sitePositions, url);
}

/**
 * Resolves the effective controller position for a given page URL.
 * Site-specific rules take priority; otherwise falls back to defaultPosition.
 */
export function resolveSitePosition(sitePositions, defaultPosition, url) {
  const fallback = normalizePosition(defaultPosition);
  const matched = findMatchingSitePosition(sitePositions, url);
  return matched ? normalizePosition(matched) : fallback;
}

export function validateSitePositionEntries(sitePositions) {
  if (!Array.isArray(sitePositions)) return { valid: true };
  for (const entry of sitePositions) {
    if (!entry || typeof entry.pattern !== 'string') {
      return { valid: false, error: 'Site pattern cannot be empty' };
    }
    const result = validateSitePattern(entry.pattern);
    if (!result.valid) {
      return result;
    }
  }
  return { valid: true };
}

export function nudgePosition(position, direction, step = 10) {
  const current = normalizePosition(position);
  const delta = Math.max(1, Math.round(Number(step) || 10));
  switch (direction) {
    case 'up':
      return { ...current, offsetY: normalizeOffset(current.offsetY - delta) };
    case 'down':
      return { ...current, offsetY: normalizeOffset(current.offsetY + delta) };
    case 'left':
      return { ...current, offsetX: normalizeOffset(current.offsetX - delta) };
    case 'right':
      return { ...current, offsetX: normalizeOffset(current.offsetX + delta) };
    default:
      return current;
  }
}

/**
 * Computes CSS coordinates and self-alignment percentages relative to the wrapper
 * element so the controller hugs the video perimeter regardless of wrapper box sizing.
 */
export function computeAnchorCoordinates(
  videoRect,
  wrapperRect,
  position,
  padding = CONTROLLER_EDGE_PADDING
) {
  if (
    !videoRect ||
    !wrapperRect ||
    videoRect.width <= 0 ||
    videoRect.height <= 0
  ) {
    return null;
  }

  const normalized = normalizePosition(position);
  const meta = POSITION_ANCHORS[normalized.anchor];
  const relLeft = videoRect.left - wrapperRect.left;
  const relTop = videoRect.top - wrapperRect.top;

  let rawX = relLeft + padding;
  let alignX = '0%';
  if (meta.col === 'center') {
    rawX = relLeft + videoRect.width / 2;
    alignX = '-50%';
  } else if (meta.col === 'right') {
    rawX = relLeft + videoRect.width - padding;
    alignX = '-100%';
  }

  let rawY = relTop + padding;
  let alignY = '0%';
  if (meta.row === 'middle') {
    rawY = relTop + videoRect.height / 2;
    alignY = '-50%';
  } else if (meta.row === 'bottom') {
    rawY = relTop + videoRect.height - padding;
    alignY = '-100%';
  }

  const anchorX = Math.round((rawX + normalized.offsetX) * 100) / 100;
  const anchorY = Math.round((rawY + normalized.offsetY) * 100) / 100;

  return {
    anchorX: `${anchorX}px`,
    anchorY: `${anchorY}px`,
    alignX,
    alignY,
  };
}

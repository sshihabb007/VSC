import { REG_ENDS_WITH_FLAGS, REG_STRIP } from './constants.js';

const ESCAPE_REGEXP_RE = /[#-.]|[[-^]|[?|{}]/g;
const compiledPatternCache = new Map();
const MAX_CACHE_ENTRIES = 256;

export function escapeRegExp(str) {
  return str.replace(ESCAPE_REGEXP_RE, '\\$&');
}

/**
 * Compile and cache a pattern matcher into a RegExp (null when blank/invalid).
 */
export function compileSitePattern(pattern) {
  if (typeof pattern !== 'string') return null;
  const trimmed = pattern.replace(REG_STRIP, '');
  if (!trimmed) return null;

  if (compiledPatternCache.has(trimmed)) {
    return compiledPatternCache.get(trimmed);
  }

  let compiled = null;
  if (trimmed.startsWith('/')) {
    const match = trimmed.match(REG_ENDS_WITH_FLAGS);
    if (match) {
      const splitIdx = match.index;
      const body = trimmed.slice(1, splitIdx);
      const flags = trimmed.slice(splitIdx + 1);
      try {
        // Strip stateful 'g' / 'y' flags so repeated .test(href) calls stay stateless
        const safeFlags = flags.replace(/[gy]/g, '');
        compiled = new RegExp(body, safeFlags);
      } catch {
        compiled = null;
      }
    }
  } else {
    const escaped = escapeRegExp(trimmed);
    const expr = !trimmed.includes('/') && trimmed.includes('.')
      ? `(^|\\.|//)${escaped}(/|:|$)`
      : escaped;
    try {
      compiled = new RegExp(expr);
    } catch {
      compiled = null;
    }
  }

  if (compiledPatternCache.size >= MAX_CACHE_ENTRIES) {
    compiledPatternCache.clear();
  }
  compiledPatternCache.set(trimmed, compiled);
  return compiled;
}

export function validateSitePattern(pattern) {
  const trimmed = typeof pattern === 'string' ? pattern.replace(REG_STRIP, '') : '';
  if (!trimmed) return { valid: false, error: 'Pattern cannot be empty' };
  const compiled = compileSitePattern(trimmed);
  if (!compiled) {
    return { valid: false, error: `Invalid pattern: ${trimmed}` };
  }
  return { valid: true, regex: compiled };
}

/**
 * Find the first site rule matching `url`.
 * @param {Array<{pattern: string, enabled?: boolean, speed?: number|null}>} siteRules
 * @param {string} url
 */
export function matchSiteRule(siteRules, url) {
  if (!Array.isArray(siteRules) || !url) return null;
  for (let i = 0; i < siteRules.length; i++) {
    const rule = siteRules[i];
    if (!rule || typeof rule.pattern !== 'string') continue;
    const regex = compileSitePattern(rule.pattern);
    if (regex && regex.test(url)) {
      return rule;
    }
  }
  return null;
}


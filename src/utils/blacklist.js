import { REG_STRIP } from './constants.js';
import { compileSitePattern } from './site-pattern.js';

export function isBlacklisted(blacklist, url = location.href) {
  if (!blacklist || !url) return false;
  const lines = blacklist.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i].replace(REG_STRIP, '');
    if (!entry) continue;
    const regex = compileSitePattern(entry);
    if (regex && regex.test(url)) {
      return true;
    }
  }
  return false;
}


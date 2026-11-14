import { BaseSiteHandler } from './base-handler.js';

export class AppleHandler extends BaseSiteHandler {
  static matches(hostname = location.hostname) {
    return hostname === 'tv.apple.com';
  }

  getControllerPosition(parent, _video) {
    const targetParent = this.getSafeParentNode(parent, { allowShadowRoot: true }) || parent;
    return {
      insertionPoint: targetParent,
      insertionMethod: 'firstChild',
      targetParent,
    };
  }

  getVideoContainerSelectors() {
    return ['apple-tv-plus-player', '[data-testid="player"]', '.video-container'];
  }

  detectSpecialVideos(doc) {
    const applePlayer = doc.querySelector('apple-tv-plus-player');
    if (applePlayer?.shadowRoot) {
      return Array.from(applePlayer.shadowRoot.querySelectorAll('video'));
    }
    return [];
  }
}


import { BaseSiteHandler } from './base-handler.js';
import { logger } from '../utils/logger.js';

export class FacebookHandler extends BaseSiteHandler {
  static matches(hostname = location.hostname) {
    return hostname === 'www.facebook.com';
  }

  getControllerPosition(parent, _video) {
    const fallbackParent = parent?.parentElement || parent;
    let targetParent = parent;

    for (let depth = 0; depth < 7; depth++) {
      if (!targetParent?.parentElement) {
        logger.warn('Facebook DOM structure changed, using fallback positioning');
        targetParent = fallbackParent;
        break;
      }
      targetParent = targetParent.parentElement;
    }

    return {
      insertionPoint: targetParent,
      insertionMethod: 'firstChild',
      targetParent,
    };
  }

  // Note: Dynamic video discovery already runs through VideoMutationObserver without
  // duplicating a redundant body-wide MutationObserver here.

  shouldIgnoreVideo(video) {
    return (
      video.closest('[data-story-id]') !== null ||
      video.closest('.story-bucket-container') !== null ||
      video.getAttribute('data-video-width') === '0'
    );
  }

  getVideoContainerSelectors() {
    return ['[data-video-id]', '.video-container', '.fbStoryVideoContainer', '[role="main"] video'];
  }
}


import { BaseSiteHandler } from './base-handler.js';
import { logger } from '../utils/logger.js';

const BOUNDARY_ROLES = new Set(['main', 'feed', 'article', 'dialog']);
const BOUNDARY_TAGS = new Set(['MAIN', 'ARTICLE', 'SECTION']);
const MAX_ANCESTOR_CLIMB = 6;

export class FacebookHandler extends BaseSiteHandler {
  static matches(hostname = typeof location !== 'undefined' ? location.hostname : '') {
    return (
      hostname === 'facebook.com' ||
      hostname.endsWith('.facebook.com') ||
      hostname === 'fb.watch' ||
      hostname.endsWith('.fb.watch')
    );
  }

  getControllerPosition(parent, video) {
    const fallbackParent = this.getSafeParentNode(parent) || parent;
    if (!parent) {
      return {
        insertionPoint: fallbackParent,
        insertionMethod: 'firstChild',
        targetParent: fallbackParent,
      };
    }

    const explicitContainer =
      typeof video?.closest === 'function'
        ? video.closest('[data-video-id], .video-container, .fbStoryVideoContainer')
        : null;
    if (
      explicitContainer &&
      explicitContainer.nodeType === 1 &&
      explicitContainer.tagName !== 'BODY' &&
      explicitContainer.tagName !== 'HTML' &&
      (!explicitContainer.contains || explicitContainer.contains(parent))
    ) {
      return {
        insertionPoint: explicitContainer,
        insertionMethod: 'firstChild',
        targetParent: explicitContainer,
      };
    }

    const videoRect =
      typeof video?.getBoundingClientRect === 'function' ? video.getBoundingClientRect() : null;
    const hasVideoBox = Boolean(videoRect && videoRect.width > 0 && videoRect.height > 0);

    let targetParent = parent;
    let climbed = 0;

    for (let depth = 0; depth < MAX_ANCESTOR_CLIMB; depth++) {
      const next = this.getSafeParentNode(targetParent);
      if (!next) break;

      const role = typeof next.getAttribute === 'function' ? next.getAttribute('role') : null;
      if (BOUNDARY_TAGS.has(next.tagName) || (role && BOUNDARY_ROLES.has(role))) {
        break;
      }

      if (hasVideoBox && typeof next.getBoundingClientRect === 'function') {
        const nextRect = next.getBoundingClientRect();
        if (
          nextRect.width > 0 &&
          nextRect.height > 0 &&
          (nextRect.height > videoRect.height * 1.5 + 120 ||
            nextRect.width > videoRect.width * 1.5 + 120)
        ) {
          break;
        }
      }

      targetParent = next;
      climbed++;
    }

    if (climbed === 0) {
      logger.debug('Facebook player container shallow or detached; using direct parent container');
      targetParent = fallbackParent;
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


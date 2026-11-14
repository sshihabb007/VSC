import { BaseSiteHandler } from './base-handler.js';
import { logger } from '../utils/logger.js';

export class YouTubeHandler extends BaseSiteHandler {
  static CLASSIFIER_RULES = Object.freeze({
    pointerHoldArms: true,
    spacebarArms: true,
  });

  static matches(hostname = location.hostname) {
    return hostname === 'www.youtube.com' || hostname === 'www.youtube-nocookie.com';
  }

  getControllerPosition(parent, _video) {
    let targetParent = this.getSafeParentNode(parent) || parent;

    // 2026 YouTube /embed/ layout places fixed #player-controls directly under <body>.
    if (
      typeof location !== 'undefined' &&
      location.pathname.startsWith('/embed/') &&
      document.body?.querySelector(':scope > #player-controls')
    ) {
      return {
        insertionPoint: document.body,
        insertionMethod: 'firstChild',
        targetParent: document.body,
      };
    }

    // Older embed layout has #player-controls sibling under grandparent #player.
    const grandParent = this.getSafeParentNode(targetParent, { allowBody: true });
    if (grandParent?.querySelector?.('#player-controls')) {
      targetParent = grandParent;
    }

    return {
      insertionPoint: targetParent || parent,
      insertionMethod: 'firstChild',
      targetParent: targetParent || parent,
    };
  }

  getClassifierRules() {
    return YouTubeHandler.CLASSIFIER_RULES;
  }

  resolveGestureMedia(event, mediaElements) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    let matched = null;
    for (let i = 0; i < mediaElements.length; i++) {
      const video = mediaElements[i];
      if (this.gestureBelongsToVideo(path, video)) {
        if (matched !== null) return null; // Ambiguous multiple player match
        matched = video;
      }
    }
    return matched;
  }

  gestureBelongsToVideo(path, video) {
    const player =
      video.closest?.('.html5-video-player') ||
      video.closest?.('#movie_player') ||
      video.closest?.('.ytp-player-content');
    if (!player) return false;

    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      if (node === player || (node?.nodeType && player.contains(node))) {
        return true;
      }
    }

    const siblings = player.parentElement?.children;
    if (siblings) {
      for (let i = 0; i < siblings.length; i++) {
        const child = siblings[i];
        if (child.id === 'player-controls') {
          for (let j = 0; j < path.length; j++) {
            const node = path[j];
            if (node === child || (node?.nodeType && child.contains(node))) {
              return true;
            }
          }
          break;
        }
      }
    }
    return false;
  }

  shouldIgnoreVideo(video) {
    return (
      video.classList.contains('video-thumbnail') ||
      Boolean(video.parentElement?.classList.contains('ytp-ad-player-overlay'))
    );
  }

  getVideoContainerSelectors() {
    return ['.html5-video-player', '#movie_player', '.ytp-player-content'];
  }

  detectSpecialVideos(doc) {
    const videos = [];
    try {
      const iframes = doc.querySelectorAll('iframe[src*="youtube.com"]');
      for (let i = 0; i < iframes.length; i++) {
        try {
          const iframeDoc = iframes[i].contentDocument;
          if (iframeDoc) {
            const list = iframeDoc.querySelectorAll('video');
            for (let j = 0; j < list.length; j++) videos.push(list[j]);
          }
        } catch {
          // Cross-origin iframe
        }
      }
    } catch (e) {
      logger.debug(`Could not access YouTube iframe videos: ${e.message}`);
    }
    return videos;
  }
}


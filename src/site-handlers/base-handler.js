import { logger } from '../utils/logger.js';

export class BaseSiteHandler {
  constructor() {
    this.hostname = typeof location !== 'undefined' ? location.hostname : '';
  }

  static matches() {
    return false;
  }

  /**
   * Returns a safe parent container without escaping `<body>`, `<html>`, or `#document`.
   */
  getSafeParentNode(node, { allowBody = false, allowShadowRoot = false } = {}) {
    const next = allowShadowRoot ? node?.parentNode : node?.parentElement;
    if (!next) return null;
    if (allowShadowRoot && next.nodeType === 11) return next;
    if (next.nodeType !== 1) return null;
    const tag = next.tagName;
    if (tag === 'HTML') return null;
    if (!allowBody && tag === 'BODY') return null;
    return next;
  }

  getControllerPosition(parent, _video) {
    return {
      insertionPoint: parent,
      insertionMethod: 'firstChild',
      targetParent: parent,
    };
  }

  getClassifierRules() {
    return null;
  }

  handleSpeedChange(video, speed) {
    video.playbackRate = speed;
  }

  handleSeek(video, seekSeconds) {
    if (video.currentTime !== undefined && video.duration) {
      const next = Math.max(0, Math.min(video.duration, video.currentTime + seekSeconds));
      video.currentTime = next;
    } else {
      video.currentTime += seekSeconds;
    }
    return true;
  }

  initialize(_document) {
    logger.debug(`Initializing ${this.constructor.name} for ${this.hostname}`);
  }

  cleanup() {
    logger.debug(`Cleaning up ${this.constructor.name}`);
  }

  shouldIgnoreVideo(_video) {
    return false;
  }

  resolveGestureMedia(_event, _mediaElements) {
    return null;
  }

  getVideoContainerSelectors() {
    return [];
  }

  detectSpecialVideos(_document) {
    return [];
  }
}


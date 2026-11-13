import { logger } from '../utils/logger.js';

export class BaseSiteHandler {
  constructor() {
    this.hostname = typeof location !== 'undefined' ? location.hostname : '';
  }

  static matches() {
    return false;
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


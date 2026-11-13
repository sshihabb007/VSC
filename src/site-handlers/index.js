import { BaseSiteHandler } from './base-handler.js';
import { NetflixHandler } from './netflix-handler.js';
import { YouTubeHandler } from './youtube-handler.js';
import { FacebookHandler } from './facebook-handler.js';
import { AmazonHandler } from './amazon-handler.js';
import { AppleHandler } from './apple-handler.js';
import { DailymotionHandler } from './dailymotion-handler.js';
import { FrameHandler } from './frame-handler.js';
import { logger } from '../utils/logger.js';

const AVAILABLE_HANDLERS = [
  NetflixHandler,
  YouTubeHandler,
  FacebookHandler,
  AmazonHandler,
  AppleHandler,
  DailymotionHandler,
  FrameHandler,
];

export class SiteHandlerManager {
  constructor() {
    this.currentHandler = null;
    this.availableHandlers = AVAILABLE_HANDLERS;
  }

  getCurrentHandler() {
    if (!this.currentHandler) {
      this.currentHandler = this.detectHandler();
    }
    return this.currentHandler;
  }

  detectHandler() {
    for (let i = 0; i < this.availableHandlers.length; i++) {
      const HandlerClass = this.availableHandlers[i];
      if (HandlerClass.matches()) {
        logger.info(`Using ${HandlerClass.name} for ${location.hostname}`);
        return new HandlerClass();
      }
    }
    logger.debug(`Using BaseSiteHandler for ${location.hostname}`);
    return new BaseSiteHandler();
  }

  initialize(doc) {
    this.getCurrentHandler().initialize(doc);
  }

  getControllerPosition(parent, video) {
    return this.getCurrentHandler().getControllerPosition(parent, video);
  }

  handleSpeedChange(video, speed) {
    this.getCurrentHandler().handleSpeedChange(video, speed);
  }

  handleSeek(video, seekSeconds) {
    return this.getCurrentHandler().handleSeek(video, seekSeconds);
  }

  shouldIgnoreVideo(video) {
    if (this.getCurrentHandler().shouldIgnoreVideo(video)) {
      return true;
    }
    // Skip GIF-like silent looping videos without native controls
    if (video.tagName === 'VIDEO' && video.loop && video.muted && !video.controls) {
      return true;
    }
    return false;
  }

  resolveGestureMedia(event, mediaElements) {
    return this.getCurrentHandler().resolveGestureMedia(event, mediaElements);
  }

  getClassifierRules() {
    return this.getCurrentHandler().getClassifierRules();
  }

  getVideoContainerSelectors() {
    return this.getCurrentHandler().getVideoContainerSelectors();
  }

  detectSpecialVideos(doc) {
    return this.getCurrentHandler().detectSpecialVideos(doc);
  }

  cleanup() {
    if (this.currentHandler) {
      this.currentHandler.cleanup();
      this.currentHandler = null;
    }
  }

  refresh(doc) {
    this.cleanup();
    this.currentHandler = this.detectHandler();
    if (doc) {
      this.currentHandler.initialize(doc);
    }
    return this.currentHandler;
  }
}

export const siteHandlerManager = new SiteHandlerManager();


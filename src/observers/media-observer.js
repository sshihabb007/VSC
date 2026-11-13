import { CONTROLLER_SIZE_LIMITS } from '../utils/constants.js';
import { findMediaElements } from '../utils/dom-utils.js';
import { logger } from '../utils/logger.js';

export class MediaElementObserver {
  constructor(config, siteHandlerManager) {
    this.config = config;
    this.siteHandlerManager = siteHandlerManager;
  }

  scanForMedia(doc) {
    if (!doc) return [];
    const audioEnabled = Boolean(this.config.settings.audioBoolean);
    const root = doc.body || doc.documentElement || doc;
    const found = findMediaElements(root, audioEnabled);

    const special = this.siteHandlerManager.detectSpecialVideos(doc);
    if (special.length > 0) {
      const seen = new Set(found);
      for (let i = 0; i < special.length; i++) {
        if (!seen.has(special[i])) {
          seen.add(special[i]);
          found.push(special[i]);
        }
      }
    }

    const valid = [];
    for (let i = 0; i < found.length; i++) {
      if (this.isValidMediaElement(found[i])) {
        valid.push(found[i]);
      }
    }
    return valid;
  }

  scanForMediaLight(doc) {
    if (!doc) return [];
    const audioEnabled = Boolean(this.config.settings.audioBoolean);
    const selector = audioEnabled ? 'video,audio' : 'video';
    const raw = doc.querySelectorAll(selector);
    const valid = [];
    for (let i = 0; i < raw.length; i++) {
      if (this.isValidMediaElement(raw[i])) {
        valid.push(raw[i]);
      }
    }
    return valid;
  }

  scanAll(doc) {
    return this.scanForMedia(doc);
  }

  isValidMediaElement(media) {
    if (!media || !media.isConnected) return false;
    if (media.tagName === 'AUDIO' && !this.config.settings.audioBoolean) {
      return false;
    }
    if (this.siteHandlerManager.shouldIgnoreVideo(media)) {
      return false;
    }

    if (media.tagName === 'VIDEO' && media.readyState >= 2) {
      const rect = media.getBoundingClientRect();
      if (
        (rect.width > 0 || rect.height > 0) &&
        (rect.width < CONTROLLER_SIZE_LIMITS.VIDEO_MIN_WIDTH ||
          rect.height < CONTROLLER_SIZE_LIMITS.VIDEO_MIN_HEIGHT)
      ) {
        logger.debug(`Ignoring small video ${rect.width}x${rect.height}`);
        return false;
      }
    }

    return true;
  }

  shouldStartHidden(media) {
    if (this.config.settings.startHidden) return true;

    try {
      const style = window.getComputedStyle(media);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return true;
      }

      const rect = media.getBoundingClientRect();
      if (media.tagName === 'AUDIO') {
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          (rect.width < CONTROLLER_SIZE_LIMITS.AUDIO_MIN_WIDTH ||
            rect.height < CONTROLLER_SIZE_LIMITS.AUDIO_MIN_HEIGHT)
        ) {
          return true;
        }
        return false;
      }

      return rect.width === 0 || rect.height === 0;
    } catch {
      return false;
    }
  }
}


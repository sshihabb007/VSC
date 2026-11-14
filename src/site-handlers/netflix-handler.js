import { BaseSiteHandler } from './base-handler.js';
import { logger } from '../utils/logger.js';

export class NetflixHandler extends BaseSiteHandler {
  static matches(hostname = location.hostname) {
    return hostname === 'www.netflix.com';
  }

  getControllerPosition(parent, _video) {
    const parentEl = this.getSafeParentNode(parent) || parent;
    return {
      insertionPoint: parentEl,
      insertionMethod: 'beforeParent',
      targetParent: parentEl,
    };
  }

  handleSeek(video, seekSeconds) {
    try {
      window.postMessage(
        {
          action: 'videospeed-seek',
          seekMs: seekSeconds * 1000,
        },
        'https://www.netflix.com'
      );
      logger.debug(`Netflix seek: ${seekSeconds}s`);
      return true;
    } catch (error) {
      logger.error(`Netflix seek failed: ${error.message}`);
      video.currentTime += seekSeconds;
      return true;
    }
  }

  shouldIgnoreVideo(video) {
    return (
      video.classList.contains('preview-video') ||
      Boolean(video.parentElement?.classList.contains('billboard-row'))
    );
  }

  getVideoContainerSelectors() {
    return ['.watch-video', '.nfp-container', '#netflix-player'];
  }
}


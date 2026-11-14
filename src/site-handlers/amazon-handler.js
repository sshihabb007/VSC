import { BaseSiteHandler } from './base-handler.js';

export class AmazonHandler extends BaseSiteHandler {
  static matches(hostname = location.hostname) {
    return (
      hostname === 'www.amazon.com' ||
      hostname === 'www.primevideo.com' ||
      hostname.includes('amazon.') ||
      hostname.includes('primevideo.')
    );
  }

  getControllerPosition(parent, video) {
    if (!video.classList.contains('vjs-tech')) {
      const parentEl = this.getSafeParentNode(parent) || parent;
      return {
        insertionPoint: parentEl,
        insertionMethod: 'beforeParent',
        targetParent: parentEl,
      };
    }
    return super.getControllerPosition(parent, video);
  }

  shouldIgnoreVideo(video) {
    if (video.readyState < 2) return false;
    const rect = video.getBoundingClientRect();
    return rect.width < 200 || rect.height < 100;
  }

  getVideoContainerSelectors() {
    return ['.dv-player-container', '.webPlayerContainer', '[data-testid="video-player"]'];
  }
}


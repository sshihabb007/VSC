import { BaseSiteHandler } from './base-handler.js';

export class FrameHandler extends BaseSiteHandler {
  static matches(hostname = location.hostname) {
    return hostname === 'next.frame.io';
  }

  getControllerPosition(parent, video) {
    const targetParent = this.findPlayerViewport(parent, video) || parent;
    return {
      insertionPoint: targetParent,
      insertionMethod: 'firstChild',
      targetParent,
    };
  }

  findPlayerViewport(parent, video) {
    const videoRect = video.getBoundingClientRect();
    if (!videoRect.width || !videoRect.height) return null;

    const minWidth = Math.min(videoRect.width * 0.5, 300);
    const minHeight = Math.min(videoRect.height * 0.5, 150);
    let candidate = parent;

    for (let depth = 0; candidate && depth < 8; depth += 1) {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      const clipsContent =
        style.overflow === 'hidden' ||
        style.overflow === 'clip' ||
        style.overflowX === 'hidden' ||
        style.overflowX === 'clip' ||
        style.overflowY === 'hidden' ||
        style.overflowY === 'clip';

      if (clipsContent && rect.width >= minWidth && rect.height >= minHeight) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return null;
  }
}


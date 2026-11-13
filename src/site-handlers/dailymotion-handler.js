import { BaseSiteHandler } from './base-handler.js';

export class DailymotionHandler extends BaseSiteHandler {
  static matches(hostname = location.hostname) {
    return hostname.includes('dailymotion.com');
  }

  getControllerPosition(parent, _video) {
    const playerContainer = parent?.parentElement || parent;
    return {
      insertionPoint: playerContainer,
      insertionMethod: 'firstChild',
      targetParent: playerContainer,
    };
  }
}


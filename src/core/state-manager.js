/**
 * Registry for active controlled media elements inside a document frame.
 */

export class VSCStateManager {
  constructor() {
    this.controllers = new Map();
    this._mediaCache = null;
  }

  registerController(controller) {
    if (!controller || !controller.controllerId) return;
    this.controllers.set(controller.controllerId, {
      controller,
      element: controller.video,
      tagName: controller.video?.tagName || 'VIDEO',
      videoSrc: controller.video?.currentSrc || controller.video?.src || '',
      created: Date.now(),
    });
    this._mediaCache = null;
  }

  removeController(controllerId) {
    if (!controllerId) return;
    if (this.controllers.delete(controllerId)) {
      this._mediaCache = null;
    }
  }

  hasControllers() {
    return this.controllers.size > 0;
  }

  /**
   * Connected controlled media elements in registration order (cached until registry changes).
   */
  getControlledElements() {
    if (this.controllers.size === 0) return [];
    const result = [];
    for (const [id, info] of this.controllers) {
      const el = info.element;
      if (el && el.isConnected) {
        result.push(el);
      } else {
        this.controllers.delete(id);
      }
    }
    return result;
  }

  getAllMediaElements() {
    return this.getControlledElements();
  }

  clear() {
    this.controllers.clear();
    this._mediaCache = null;
  }
}

export const stateManager = new VSCStateManager();


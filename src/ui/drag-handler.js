import { logger } from '../utils/logger.js';

const controllerOffsets = new WeakMap();

export class DragHandler {
  static getOffset(controllerEl) {
    return controllerOffsets.get(controllerEl) || { x: 0, y: 0 };
  }

  static resetOffset(controllerEl) {
    controllerOffsets.delete(controllerEl);
    controllerEl?.style.setProperty('--vsc-tx', '0px');
    controllerEl?.style.setProperty('--vsc-ty', '0px');
  }

  /**
   * 60/120fps rAF-coalesced composited GPU drag with viewport safety clamping.
   */
  static handleDrag(video, e) {
    const wrapper = video?.vsc?.div;
    const shadowController = wrapper?.shadowRoot?.querySelector('#controller');
    if (!shadowController) return;

    const draggable = e.currentTarget || e.target;
    const startOffset = this.getOffset(shadowController);
    const startClientX = e.clientX;
    const startClientY = e.clientY;

    // Sample viewport bounds once at drag start — zero layout reads during pointermove
    const rect = shadowController.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 1920;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1080;
    const pad = 4;
    const minDx = -rect.left + pad;
    const maxDx = Math.max(minDx, vw - rect.right - pad);
    const minDy = -rect.top + pad;
    const maxDy = Math.max(minDy, vh - rect.bottom - pad);

    let pendingX = startOffset.x;
    let pendingY = startOffset.y;
    let rafId = 0;

    video.classList.add('vcs-dragging');
    shadowController.classList.add('dragging');

    if (e.pointerId !== undefined && typeof draggable.setPointerCapture === 'function') {
      try {
        draggable.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or detached pointer event
      }
    }

    const flushFrame = () => {
      rafId = 0;
      shadowController.style.setProperty('--vsc-tx', `${pendingX}px`);
      shadowController.style.setProperty('--vsc-ty', `${pendingY}px`);
      controllerOffsets.set(shadowController, { x: pendingX, y: pendingY });
    };

    const onMove = (ev) => {
      const rawDx = ev.clientX - startClientX;
      const rawDy = ev.clientY - startClientY;
      const clampedDx = Math.min(Math.max(rawDx, minDx), maxDx);
      const clampedDy = Math.min(Math.max(rawDy, minDy), maxDy);
      pendingX = startOffset.x + clampedDx;
      pendingY = startOffset.y + clampedDy;

      if (!rafId) {
        rafId = requestAnimationFrame(flushFrame);
      }
    };

    const onEnd = (ev) => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        flushFrame();
      }

      if (e.pointerId !== undefined) {
        draggable.removeEventListener('pointermove', onMove);
        draggable.removeEventListener('pointerup', onEnd);
        draggable.removeEventListener('pointercancel', onEnd);
        if (typeof draggable.releasePointerCapture === 'function') {
          try {
            if (draggable.hasPointerCapture?.(e.pointerId)) {
              draggable.releasePointerCapture(e.pointerId);
            }
          } catch {
            // ignore
          }
        }
      } else {
        draggable.removeEventListener('mousemove', onMove);
        draggable.removeEventListener('mouseup', onEnd);
      }

      shadowController.classList.remove('dragging');
      video.classList.remove('vcs-dragging');
      logger.debug(`Drag completed at (${pendingX}px, ${pendingY}px)`);
      if (ev?.type === 'pointercancel') {
        // Position still cleanly settled
      }
    };

    if (e.pointerId !== undefined) {
      draggable.addEventListener('pointermove', onMove);
      draggable.addEventListener('pointerup', onEnd);
      draggable.addEventListener('pointercancel', onEnd);
    } else {
      draggable.addEventListener('mousemove', onMove);
      draggable.addEventListener('mouseup', onEnd);
    }
  }
}


import { logger } from '../utils/logger.js';

const HOVER_DWELL_MS = 300;
const TOUCHPAD_THRESHOLD = 50;

export class ControlsManager {
  constructor(actionHandler, config) {
    this.actionHandler = actionHandler;
    this.config = config;
    this.abortController = new AbortController();
  }

  setupControlEvents(shadow, video) {
    const { signal } = this.abortController;
    this.setupDragHandler(shadow, signal);
    this.setupButtonHandlers(shadow, signal);
    this.setupWheelHandler(shadow, video, signal);
    this.setupClickPrevention(shadow, signal);
  }

  setupDragHandler(shadow, signal) {
    const draggable = shadow.querySelector('.draggable');
    if (!draggable) return;

    draggable.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        this.actionHandler.runAction(e.currentTarget.dataset.action, false, e);
        e.stopPropagation();
        e.preventDefault();
      },
      { capture: true, signal }
    );

    draggable.addEventListener(
      'dblclick',
      (e) => {
        const resetTarget = this.config.getKeyBinding('reset') || 1.0;
        this.actionHandler.runAction('reset', resetTarget, e);
        e.stopPropagation();
        e.preventDefault();
      },
      { capture: true, signal }
    );
  }

  setupButtonHandlers(shadow, signal) {
    const buttons = shadow.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      button.addEventListener(
        'click',
        (e) => {
          const action = e.currentTarget.dataset.action;
          this.actionHandler.runAction(action, this.config.getKeyBinding(action), e);
          e.stopPropagation();
        },
        { capture: true, signal }
      );

      button.addEventListener(
        'touchstart',
        (e) => {
          e.stopPropagation();
        },
        { capture: true, passive: true, signal }
      );
    }
  }

  setupWheelHandler(shadow, video, signal) {
    const controller = shadow.querySelector('#controller');
    if (!controller) return;

    let hoverStart = 0;

    controller.addEventListener(
      'mouseenter',
      (e) => {
        hoverStart = e.timeStamp;
      },
      { signal }
    );

    controller.addEventListener(
      'mouseleave',
      () => {
        hoverStart = 0;
      },
      { signal }
    );

    controller.addEventListener(
      'wheel',
      (event) => {
        if (event.ctrlKey) {
          logger.debug('Browser zoom gesture ignored');
          return;
        }
        if (hoverStart === 0 || event.timeStamp - hoverStart < HOVER_DWELL_MS) {
          logger.debug('Wheel ignored: hover dwell threshold not met');
          return;
        }
        if (event.deltaMode === event.DOM_DELTA_PIXEL && Math.abs(event.deltaY) < TOUCHPAD_THRESHOLD) {
          logger.debug(`Touchpad scroll ignored (deltaY=${event.deltaY})`);
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const speedDelta = Math.sign(event.deltaY) < 0 ? 0.1 : -0.1;
        this.actionHandler.adjustSpeed(video, speedDelta, { relative: true });
      },
      { passive: false, signal }
    );
  }

  setupClickPrevention(shadow, signal) {
    const controller = shadow.querySelector('#controller');
    if (!controller) return;
    controller.addEventListener('click', (e) => e.stopPropagation(), { signal });
    controller.addEventListener('mousedown', (e) => e.stopPropagation(), { signal });
  }

  cleanup() {
    this.abortController.abort();
  }
}


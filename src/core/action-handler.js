import {
  CUSTOM_ACTIONS_NO_VALUES,
  LOG_LEVELS,
  SPEED_LIMITS,
  clampSpeed,
  formatSpeed,
  roundSpeed,
} from '../utils/constants.js';
import { ControllerVisibility } from './controller-visibility.js';
import { DragHandler } from '../ui/drag-handler.js';
import { siteHandlerManager } from '../site-handlers/index.js';
import { stateManager } from './state-manager.js';
import { logger } from '../utils/logger.js';

export class ActionHandler {
  constructor(config, eventManager) {
    this.config = config;
    this.eventManager = eventManager;
  }

  createAuthorityBatch() {
    let startedEpoch = false;
    return {
      claimWriteOptions() {
        const startsAuthorityEpoch = !startedEpoch;
        startedEpoch = true;
        return { startsAuthorityEpoch };
      },
    };
  }

  runAction(action, value, e) {
    const mediaTags = stateManager.getControlledElements();
    const target = e?.target;
    const rootHost = target?.getRootNode?.()?.host;
    const isControllerEvent = rootHost?.tagName === 'VSC-CONTROLLER';
    const authorityBatch = isControllerEvent ? null : this.createAuthorityBatch();

    for (let i = 0; i < mediaTags.length; i++) {
      const video = mediaTags[i];
      const controller = video.vsc?.div;

      if (!controller) continue;

      if (e) {
        if (e.target === controller) {
          this.executeAction(action, value, video, e, authorityBatch);
          continue;
        }
        if (isControllerEvent) {
          if (rootHost !== controller) continue;
        } else if (target?.tagName === 'VSC-CONTROLLER' || (target && controller.contains?.(target))) {
          continue;
        }
      }

      this.executeAction(action, value, video, e, authorityBatch);
    }
  }

  executeAction(action, value, video, e, authorityBatch = null) {
    let numericValue = Number(value);
    if (action !== 'drag' && action !== 'display' && CUSTOM_ACTIONS_NO_VALUES.indexOf(action) === -1) {
      if (!Number.isFinite(numericValue)) {
        numericValue = 0;
      }
    }

    switch (action) {
      case 'reset':
        this.resetSpeed(video, numericValue, this.config.getKeyBinding('fast'), { authorityBatch });
        break;
      case 'fast':
        this.resetSpeed(video, numericValue, this.config.getKeyBinding('reset'), { authorityBatch });
        break;
      case 'slower':
        this.adjustSpeed(video, -numericValue, { relative: true, authorityBatch });
        break;
      case 'faster':
        this.adjustSpeed(video, numericValue, { relative: true, authorityBatch });
        break;
      case 'rewind':
        siteHandlerManager.handleSeek(video, -numericValue);
        break;
      case 'advance':
        siteHandlerManager.handleSeek(video, numericValue);
        break;
      case 'pause':
        this.pause(video);
        break;
      case 'muted':
        this.muted(video);
        break;
      case 'louder':
        this.volumeUp(video, numericValue);
        break;
      case 'softer':
        this.volumeDown(video, numericValue);
        break;
      case 'mark':
        this.setMark(video);
        break;
      case 'jump':
        this.jumpToMark(video);
        break;
      case 'display': {
        const controller = video.vsc?.div;
        if (controller) {
          this.toggleControllerVisibility(controller);
        }
        break;
      }
      case 'blink':
        if (video.vsc?.div) {
          this.flashController(video.vsc.div, numericValue || undefined, video.tagName === 'AUDIO');
        }
        break;
      case 'drag':
        if (e) {
          DragHandler.handleDrag(video, e);
        }
        break;
      default:
        logger.warn(`Unknown action: ${action}`);
        break;
    }
  }

  adjustSpeed(video, value, options = {}) {
    if (!video || !video.vsc) return;

    const { relative = false, source = 'internal', authorityBatch = null } = options;

    if (logger.isEnabled(LOG_LEVELS.DEBUG)) {
      logger.withContext(video, () => {
        logger.debug(`adjustSpeed value=${value} relative=${relative} source=${source}`);
      });
    }

    if (isNaN(video.playbackRate)) return;

    const currentSpeed = video.playbackRate < 0.1 ? 0.0 : video.playbackRate;
    let targetSpeed = relative ? currentSpeed + value : value;

    // Boundary snap when crossing 1.0x
    if (relative) {
      if ((currentSpeed > 1.0 && targetSpeed < 1.0) || (currentSpeed < 1.0 && targetSpeed > 1.0)) {
        targetSpeed = 1.0;
      }
    }

    targetSpeed = roundSpeed(clampSpeed(targetSpeed));

    if (source === 'internal') {
      const writeOptions = authorityBatch ? authorityBatch.claimWriteOptions() : {};
      this.setSpeed(video, targetSpeed, writeOptions);
    } else {
      this.syncIndicator(video, targetSpeed);
    }
  }

  writeRate(video, speed, options = {}) {
    const rate = roundSpeed(speed);
    this.eventManager?.arbitration?.noteWrite(video, rate, {
      suppressPropagation: Boolean(options.suppressEchoPropagation),
    });
    siteHandlerManager.handleSpeedChange(video, rate);
  }

  syncIndicator(video, numericSpeed) {
    const rounded = roundSpeed(numericSpeed);
    const indicator = video.vsc?.speedIndicator;
    if (indicator) {
      indicator.textContent = formatSpeed(rounded);
    }
    const controller = video.vsc?.div;
    if (controller) {
      this.flashController(controller, undefined, video.tagName === 'AUDIO');
    }
  }

  setSpeed(video, speed, options = {}) {
    const numericSpeed = roundSpeed(clampSpeed(speed));
    const arbitration = this.eventManager?.arbitration;

    if (arbitration) {
      arbitration.noteUserSet(video, numericSpeed, options);
    } else {
      this.config.persistAuthority(numericSpeed);
    }

    this.writeRate(video, numericSpeed);
    this.syncIndicator(video, numericSpeed);
  }

  resetSpeed(video, target, crossTarget = null, options = {}) {
    const current = video.playbackRate;
    const vsc = video.vsc;
    if (!vsc) return;

    const apply = (nextTarget) => {
      this.adjustSpeed(video, nextTarget, { authorityBatch: options.authorityBatch });
    };

    if (current !== target) {
      vsc.speedBeforeReset = current;
      apply(target);
    } else if (vsc.speedBeforeReset !== null && vsc.speedBeforeReset !== undefined) {
      const prev = vsc.speedBeforeReset;
      vsc.speedBeforeReset = null;
      apply(prev);
    } else if (crossTarget && crossTarget !== target) {
      vsc.speedBeforeReset = current;
      apply(crossTarget);
    } else {
      apply(target);
    }
  }

  pause(video) {
    if (video.paused) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } else {
      video.pause();
    }
  }

  muted(video) {
    video.muted = !video.muted;
  }

  volumeUp(video, value) {
    video.volume = Math.min(1, roundSpeed(video.volume + value));
  }

  volumeDown(video, value) {
    video.volume = Math.max(0, roundSpeed(video.volume - value));
  }

  setMark(video) {
    if (video.vsc) {
      video.vsc.mark = video.currentTime;
    }
  }

  jumpToMark(video) {
    const vsc = video.vsc;
    if (!vsc || typeof vsc.mark !== 'number') return;

    if (vsc.positionBeforeJump !== null && vsc.positionBeforeJump !== undefined && Math.abs(video.currentTime - vsc.mark) < 0.05) {
      video.currentTime = vsc.positionBeforeJump;
      vsc.positionBeforeJump = null;
    } else {
      vsc.positionBeforeJump = video.currentTime;
      video.currentTime = vsc.mark;
    }
  }

  toggleControllerVisibility(controller) {
    const shadowController = controller.shadowRoot?.querySelector('#controller');
    const override = ControllerVisibility.normalizeOverride(controller.dataset.vscVisibility);

    let renderedVisible;
    if (override === ControllerVisibility.OVERRIDES.AUTO) {
      const hostVisible = getComputedStyle(controller).visibility !== 'hidden';
      const innerVisible = shadowController
        ? getComputedStyle(shadowController).display !== 'none'
        : !controller.classList.contains('vsc-hidden');
      renderedVisible = hostVisible && innerVisible;
    }

    if (controller.flashTimer !== undefined) {
      clearTimeout(controller.flashTimer);
      controller.flashTimer = undefined;
    }
    controller.classList.remove('vsc-show');

    const next = ControllerVisibility.nextOverride(override, renderedVisible);
    controller.dataset.vscVisibility = next;
  }

  flashController(controller, duration = 2000, isAudio = false) {
    if (!controller) return;
    if (
      !ControllerVisibility.allowsFlash({
        attached: controller.isConnected,
        startHidden: this.config.settings.startHidden,
        override: controller.dataset.vscVisibility,
      })
    ) {
      return;
    }

    if (controller.flashTimer !== undefined) {
      clearTimeout(controller.flashTimer);
      controller.flashTimer = undefined;
    }

    controller.classList.add('vsc-show');
    if (isAudio) return;

    controller.flashTimer = setTimeout(() => {
      controller.flashTimer = undefined;
      controller.classList.remove('vsc-show');
    }, duration);
  }
}

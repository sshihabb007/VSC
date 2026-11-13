import { formatSpeed } from '../utils/constants.js';
import { ShadowDOMManager } from '../ui/shadow-dom.js';
import { ControlsManager } from '../ui/controls.js';
import { DragHandler } from '../ui/drag-handler.js';
import { SpeedArbitration } from './speed-arbitration.js';
import { computeAnchorCoordinates } from './position.js';
import { siteHandlerManager } from '../site-handlers/index.js';
import { stateManager } from './state-manager.js';
import { logger } from '../utils/logger.js';

export class VideoController {
  constructor(target, parent, config, actionHandler, shouldStartHidden = false) {
    if (target.vsc) {
      return target.vsc;
    }

    this.video = target;
    this.parent = target.parentElement || parent;
    this.config = config;
    this.actionHandler = actionHandler;
    this.arbitration =
      actionHandler?.eventManager?.arbitration || new SpeedArbitration(config, null);
    this.controlsManager = new ControlsManager(actionHandler, config);
    this.shouldStartHidden = shouldStartHidden;
    this.controllerId = this.generateControllerId(target);

    this.speedBeforeReset = null;
    this.positionBeforeJump = null;
    this.mark = null;
    this._lastCoordsKey = null;
    this._posRafId = 0;
    this.resizeObserver = null;
    this.handleFullscreenChange = null;

    target.vsc = this;
    stateManager.registerController(this);

    this.initializeSpeed();
    this.div = this.initializeControls();
    this.setupPositionObservers();
    this.setupEventHandlers();
    this.setupMutationObserver();

    logger.info(`VideoController initialized (${this.controllerId})`);
  }

  initializeSpeed() {
    if (this.video.readyState < 1) {
      logger.debug('Deferring initializeSpeed until loadedmetadata');
      this.handleLoadedMetadata = () => {
        this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
        this.handleLoadedMetadata = null;
        this.applyLifecycleSpeed('loadedmetadata');
      };
      this.video.addEventListener('loadedmetadata', this.handleLoadedMetadata);
      return;
    }
    this.applyLifecycleSpeed('initializeSpeed');
  }

  applyLifecycleSpeed(eventType) {
    if (this.video.vsc !== this || !this.actionHandler) return;

    if (eventType === 'initializeSpeed' || eventType === 'loadedmetadata') {
      this.arbitration.classifier?.observeMediaInit(this.video, performance.now());
    }

    const targetSpeed = this.arbitration.lifecycleTarget(this.video);
    if (targetSpeed === null) return;
    if (targetSpeed === this.video.playbackRate) return;

    logger.info(`${eventType}: applying speed ${targetSpeed}`);
    this.actionHandler.writeRate(this.video, targetSpeed);
    this.actionHandler.syncIndicator(this.video, targetSpeed);
  }

  initializeControls() {
    const doc = this.video.ownerDocument;
    const speed = formatSpeed(this.video.playbackRate);
    const wrapper = doc.createElement('vsc-controller');

    const classes = ['vsc-controller'];
    if (!this.video.currentSrc && !this.video.src && this.video.readyState < 2) {
      classes.push('vsc-nosource');
    }
    if (this.config.settings.startHidden || this.shouldStartHidden) {
      classes.push('vsc-hidden');
    }

    wrapper.className = classes.join(' ');
    wrapper.style.cssText = 'z-index: 9999999 !important;';

    const shadow = ShadowDOMManager.createShadowDOM(wrapper, {
      speed,
      opacity: this.config.settings.controllerOpacity,
      buttonSize: this.config.settings.controllerButtonSize,
    });

    this.controlsManager.setupControlEvents(shadow, this.video);
    this.speedIndicator = ShadowDOMManager.getSpeedIndicator(shadow);
    this.div = wrapper;

    this.insertIntoDOM(doc, wrapper);
    this.updatePosition(true, wrapper);

    return wrapper;
  }

  insertIntoDOM(doc, wrapper) {
    const frag = doc.createDocumentFragment();
    frag.appendChild(wrapper);

    const pos = siteHandlerManager.getControllerPosition(this.parent, this.video);
    const anchor = pos?.insertionPoint || this.parent;
    if (!anchor) return;

    switch (pos.insertionMethod) {
      case 'beforeParent':
        if (anchor.parentElement) {
          anchor.parentElement.insertBefore(frag, anchor);
          return;
        }
        break;
      case 'afterParent':
        if (anchor.parentElement) {
          anchor.parentElement.insertBefore(frag, anchor.nextSibling);
          return;
        }
        break;
      case 'firstChild':
      default:
        break;
    }
    anchor.insertBefore(frag, anchor.firstChild);
  }

  updateAppearance(settings) {
    if (!this.div?.shadowRoot) return;
    ShadowDOMManager.updateAppearance(this.div.shadowRoot, {
      opacity: settings.controllerOpacity,
      buttonSize: settings.controllerButtonSize,
    });
  }

  updatePosition(resetDrag = false, wrapperOverride = null) {
    const wrapper = wrapperOverride || this.div;
    const shadow = wrapper?.shadowRoot;
    if (!shadow) return;

    if (resetDrag) {
      this._lastCoordsKey = null;
      const innerController = ShadowDOMManager.getController(shadow);
      DragHandler.resetOffset(innerController);
    }

    if (!this.video?.isConnected || !wrapper.isConnected) return;
    const vRect = this.video.getBoundingClientRect();
    const wRect = wrapper.getBoundingClientRect();
    const targetUrl = typeof location !== 'undefined' ? location.href : '';
    const posConfig =
      typeof this.config.resolvePosition === 'function'
        ? this.config.resolvePosition(targetUrl)
        : undefined;
    const coords = computeAnchorCoordinates(vRect, wRect, posConfig);
    if (!coords) return;

    const key = `${coords.anchorX}|${coords.anchorY}|${coords.alignX}|${coords.alignY}`;
    if (key === this._lastCoordsKey) return;
    this._lastCoordsKey = key;
    ShadowDOMManager.applyPosition(shadow, coords);
  }

  setupPositionObservers() {
    if (typeof ResizeObserver === 'function') {
      let scheduled = false;
      this.resizeObserver = new ResizeObserver(() => {
        if (scheduled) return;
        scheduled = true;
        this._posRafId = requestAnimationFrame(() => {
          this._posRafId = 0;
          scheduled = false;
          this.updatePosition(false);
        });
      });
      this.resizeObserver.observe(this.video);
      if (this.div?.parentElement) {
        this.resizeObserver.observe(this.div.parentElement);
      }
    }

    this._posRafId = requestAnimationFrame(() => {
      this._posRafId = 0;
      this.updatePosition(false);
    });

    this.handleFullscreenChange = () => {
      requestAnimationFrame(() => this.updatePosition(false));
    };
    const doc = this.video?.ownerDocument || document;
    doc.addEventListener('fullscreenchange', this.handleFullscreenChange);
    doc.addEventListener('webkitfullscreenchange', this.handleFullscreenChange);
  }

  setupEventHandlers() {
    const mediaEventAction = (event) => {
      this.applyLifecycleSpeed(event.type);
    };

    this.handlePlay = (event) => mediaEventAction(event);
    this.handleSeekEvidence = (event) => {
      this.arbitration.classifier?.observeSeek(this.video, event.timeStamp);
    };
    this.handleSeek = (event) => {
      this.handleSeekEvidence(event);
      if (event.target.readyState < 2) return;
      mediaEventAction(event);
    };
    this.handleMediaInit = (event) => {
      this.arbitration.clearEchoTransaction(this.video);
      this.arbitration.classifier?.observeMediaInit(this.video, event.timeStamp);
    };

    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('seeking', this.handleSeekEvidence);
    this.video.addEventListener('seeked', this.handleSeek);
    this.video.addEventListener('loadstart', this.handleMediaInit);
  }

  setupMutationObserver() {
    this.targetObserver = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'attributes' && (m.attributeName === 'src' || m.attributeName === 'currentSrc')) {
          const target = m.target;
          if (!target.src && !target.currentSrc) {
            this.div.classList.add('vsc-nosource');
          } else {
            this.div.classList.remove('vsc-nosource');
          }
          break;
        }
      }
    });

    this.targetObserver.observe(this.video, {
      attributeFilter: ['src', 'currentSrc'],
    });
  }

  remove() {
    if (this._posRafId) {
      cancelAnimationFrame(this._posRafId);
      this._posRafId = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.handleFullscreenChange) {
      const doc = this.video?.ownerDocument || document;
      doc.removeEventListener('fullscreenchange', this.handleFullscreenChange);
      doc.removeEventListener('webkitfullscreenchange', this.handleFullscreenChange);
      this.handleFullscreenChange = null;
    }

    if (this.div?.flashTimer !== undefined) {
      clearTimeout(this.div.flashTimer);
      this.div.flashTimer = undefined;
    }

    this.controlsManager?.cleanup();

    if (this.div?.parentNode) {
      this.div.remove();
    }

    if (this.handlePlay) {
      this.video.removeEventListener('play', this.handlePlay);
      this.handlePlay = null;
    }
    if (this.handleSeek) {
      this.video.removeEventListener('seeked', this.handleSeek);
      this.handleSeek = null;
    }
    if (this.handleSeekEvidence) {
      this.video.removeEventListener('seeking', this.handleSeekEvidence);
      this.handleSeekEvidence = null;
    }
    if (this.handleMediaInit) {
      this.video.removeEventListener('loadstart', this.handleMediaInit);
      this.handleMediaInit = null;
    }
    if (this.handleLoadedMetadata) {
      this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
      this.handleLoadedMetadata = null;
    }

    this.targetObserver?.disconnect();
    stateManager.removeController(this.controllerId);
    this.actionHandler?.eventManager?.arbitration?.release(this.video);
    delete this.video.vsc;
  }

  generateControllerId(target) {
    const src = target.currentSrc || target.src || 'no-src';
    const limit = Math.min(src.length, 256);
    let hash = 2166136261;
    for (let i = 0; i < limit; i++) {
      hash ^= src.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const tagName = target.tagName.toLowerCase();
    const rand = Math.floor(Math.random() * 1000);
    return `${tagName}-${(hash >>> 0).toString(36)}-${Date.now().toString(36)}-${rand}`;
  }

  isVideoVisible() {
    if (!this.video.isConnected) return false;
    const style = window.getComputedStyle(this.video);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = this.video.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  updateVisibility() {
    const isHidden = this.div.classList.contains('vsc-hidden');
    if (this.video.tagName === 'AUDIO') {
      if (!this.config.settings.audioBoolean && !isHidden) {
        this.div.classList.add('vsc-hidden');
      } else if (
        this.config.settings.audioBoolean &&
        isHidden &&
        !this.config.settings.startHidden
      ) {
        this.div.classList.remove('vsc-hidden');
      }
      return;
    }

    const isVisible = this.isVideoVisible();
    if (isVisible && isHidden && !this.config.settings.startHidden) {
      this.div.classList.remove('vsc-hidden');
    } else if (!isVisible && !isHidden) {
      this.div.classList.add('vsc-hidden');
    }
  }
}


import { DEFAULT_CONTROLLER_CSS, preprocessDomainCSS } from '../styles/controller-css-defaults.js';
import { MESSAGE_TYPES, clampSpeed } from '../utils/constants.js';
import { initializeWhenReady } from '../utils/dom-utils.js';
import { logger } from '../utils/logger.js';
import { VideoController } from '../core/video-controller.js';
import { ActionHandler } from '../core/action-handler.js';
import { EventManager } from '../utils/event-manager.js';
import { videoSpeedConfig } from '../core/settings.js';
import { stateManager } from '../core/state-manager.js';
import { siteHandlerManager } from '../site-handlers/index.js';
import { VideoMutationObserver } from '../observers/mutation-observer.js';
import { MediaElementObserver } from '../observers/media-observer.js';

export class VideoSpeedExtension {
  constructor() {
    this.config = videoSpeedConfig;
    this.actionHandler = null;
    this.eventManager = null;
    this.mutationObserver = null;
    this.mediaObserver = null;

    this.deferredMediaListeners = new Map();
    this.acceptingMedia = true;
    this.initialized = false;

    this._controllerSheet = null;
    this._startupCancel = null;
    this._readyCancel = null;
    this._fallbackScanTimer = 0;
    this.runtimeAbort = new AbortController();
  }

  async initialize() {
    try {
      logger.info('Video Speed Controller starting...');
      await this.config.load();

      if (this.config.settings._abort || !this.acceptingMedia) {
        logger.debug('Extension disabled on this site — aborting init');
        return;
      }

      this.setupBridgeListeners();
      this.deferDOMWork(document);
    } catch (error) {
      logger.error(`Initialization failed: ${error.message}`);
    }
  }

  setupBridgeListeners() {
    const docEl = document.documentElement;
    if (!docEl) return;
    const { signal } = this.runtimeAbort;

    docEl.addEventListener(
      'VSC_MESSAGE',
      (event) => {
        const message = event.detail;
        if (!message || typeof message !== 'object' || !message.type?.startsWith('VSC_')) {
          return;
        }
        this.handleMessage(message);
      },
      { signal }
    );

    docEl.addEventListener(
      'VSC_STORAGE_CHANGED',
      (event) => {
        this.handleLiveSettingsUpdate(event.detail);
      },
      { signal }
    );

    docEl.addEventListener(
      MESSAGE_TYPES.QUERY_STATE,
      () => {
        const media = stateManager.getAllMediaElements();
        const primary = media[0];
        const detail = {
          count: media.length,
          speed: primary ? Number(primary.playbackRate.toFixed(2)) : null,
          paused: primary ? Boolean(primary.paused) : null,
          url: location.href,
          hostname: location.hostname.replace(/^www\./i, ''),
        };
        docEl.dispatchEvent(new CustomEvent(MESSAGE_TYPES.STATE_REPLY, { detail }));
      },
      { signal }
    );

    const onSpaNavigate = () => this.handleSpaNavigation();
    window.addEventListener('popstate', onSpaNavigate, { signal });
    window.addEventListener('hashchange', onSpaNavigate, { signal });
    if (typeof window.navigation?.addEventListener === 'function') {
      window.navigation.addEventListener('navigatesuccess', onSpaNavigate, { signal });
    }
  }

  handleSpaNavigation() {
    if (!this.acceptingMedia || !this.initialized) return;

    const matchedRule = this.config.evaluateSiteRule(location.href);
    if (matchedRule && matchedRule.enabled === false) {
      this.teardown();
      return;
    }

    siteHandlerManager.refresh(document);
    this.eventManager?.refreshClassifierRules();

    if (this.config.settings.siteDefaultSpeed !== null) {
      const targetSpeed = this.config.settings.siteDefaultSpeed;
      const authorityBatch = this.actionHandler?.createAuthorityBatch();
      const videos = stateManager.getControlledElements();
      for (let i = 0; i < videos.length; i++) {
        this.actionHandler?.adjustSpeed(videos[i], targetSpeed, { authorityBatch });
      }
    }

    for (const info of stateManager.controllers.values()) {
      info.controller.updatePosition(true);
    }

    // Catch newly swapped player nodes on navigation
    this.scanDocumentMedia(document);
  }

  handleLiveSettingsUpdate(changes) {
    if (!changes) return;

    const appearanceChanged =
      changes.controllerOpacity !== undefined || changes.controllerButtonSize !== undefined;
    const visibilityChanged =
      changes.startHidden !== undefined || changes.audioBoolean !== undefined;
    const positionChanged =
      changes.defaultPosition !== undefined || changes.sitePositions !== undefined;

    if (appearanceChanged || visibilityChanged || positionChanged) {
      for (const info of stateManager.controllers.values()) {
        if (appearanceChanged) {
          info.controller.updateAppearance(this.config.settings);
        }
        if (visibilityChanged) {
          info.controller.updateVisibility();
        }
        if (positionChanged) {
          info.controller.updatePosition(true);
        }
      }
      if (changes.audioBoolean?.newValue === true) {
        this.scanDocumentMedia(document);
      }
    }
  }

  handleMessage(message) {
    if (message.type === MESSAGE_TYPES.TEARDOWN) {
      this.teardown();
      return;
    }
    if (!this.actionHandler) return;

    const videos = stateManager.getAllMediaElements();
    switch (message.type) {
      case MESSAGE_TYPES.SET_SPEED:
        if (message.payload && typeof message.payload.speed === 'number') {
          const targetSpeed = clampSpeed(message.payload.speed);
          const authorityBatch = this.actionHandler.createAuthorityBatch();
          for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            if (video.vsc) {
              this.actionHandler.adjustSpeed(video, targetSpeed, { authorityBatch });
            } else {
              video.playbackRate = targetSpeed;
            }
          }
        }
        break;

      case MESSAGE_TYPES.ADJUST_SPEED:
        if (message.payload && typeof message.payload.delta === 'number') {
          const delta = message.payload.delta;
          const authorityBatch = this.actionHandler.createAuthorityBatch();
          for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            if (video.vsc) {
              this.actionHandler.adjustSpeed(video, delta, { relative: true, authorityBatch });
            } else {
              video.playbackRate = clampSpeed(video.playbackRate + delta);
            }
          }
        }
        break;

      case MESSAGE_TYPES.RESET_SPEED: {
        const authorityBatch = this.actionHandler.createAuthorityBatch();
        for (let i = 0; i < videos.length; i++) {
          const video = videos[i];
          if (video.vsc) {
            this.actionHandler.resetSpeed(video, 1.0, undefined, { authorityBatch });
          } else {
            video.playbackRate = 1.0;
          }
        }
        break;
      }

      case MESSAGE_TYPES.TOGGLE_DISPLAY:
        this.actionHandler.runAction('display', null, null);
        break;
    }
  }

  deferDOMWork(doc) {
    const startSetup = () => {
      this._startupCancel = null;
      if (!this.acceptingMedia) return;

      this.injectControllerCSS();
      siteHandlerManager.initialize(doc);

      this.eventManager = new EventManager(this.config, null);
      this.actionHandler = new ActionHandler(this.config, this.eventManager);
      this.eventManager.actionHandler = this.actionHandler;

      this.mediaObserver = new MediaElementObserver(this.config, siteHandlerManager);
      this.mutationObserver = new VideoMutationObserver(
        this.config,
        (video, parent) => this.onVideoFound(video, parent),
        (video) => this.onVideoRemoved(video),
        this.mediaObserver
      );

      this._readyCancel = initializeWhenReady(doc, (readyDoc) => {
        this._readyCancel = null;
        if (this.acceptingMedia) {
          this.initializeDocument(readyDoc);
        }
      });

      this.initialized = true;
    };

    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(startSetup, { timeout: 150 });
      this._startupCancel = () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(startSetup, 0);
      this._startupCancel = () => clearTimeout(id);
    }
  }

  initializeDocument(doc) {
    if (!this.acceptingMedia) return;
    this.eventManager.setupEventListeners(doc);
    this.mutationObserver?.start(doc);

    const attached = this.scanDocumentMedia(doc);
    if (attached === 0) {
      // Single bounded follow-up sweep for late-mounted shadow / lazy media
      this._fallbackScanTimer = setTimeout(() => {
        this._fallbackScanTimer = 0;
        if (this.acceptingMedia) {
          this.scanDocumentMedia(doc);
        }
      }, 600);
    }
  }

  scanDocumentMedia(doc) {
    if (!this.acceptingMedia || !this.mediaObserver) return 0;
    const mediaList = this.mediaObserver.scanAll(doc);
    let attached = 0;
    for (let i = 0; i < mediaList.length; i++) {
      const media = mediaList[i];
      if (!media.vsc) {
        this.onVideoFound(media, media.parentElement || media.parentNode);
        attached++;
      }
    }
    return attached;
  }

  injectControllerCSS() {
    try {
      if (this._controllerSheet) return;
      this._controllerSheet = new CSSStyleSheet();
      this._controllerSheet.replaceSync(
        preprocessDomainCSS(DEFAULT_CONTROLLER_CSS, location.hostname)
      );
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, this._controllerSheet];
    } catch (error) {
      logger.error(`Failed to inject controller CSS: ${error.message}`);
    }
  }

  onVideoFound(video, parent) {
    try {
      if (!this.acceptingMedia) return;
      if (this.mediaObserver && !this.mediaObserver.isValidMediaElement(video)) return;
      if (video.vsc) return;

      if (video.readyState < 2) {
        if (this.deferredMediaListeners.has(video)) return;
        const listener = () => {
          this.deferredMediaListeners.delete(video);
          this.onVideoFound(video, video.parentElement || parent);
        };
        this.deferredMediaListeners.set(video, listener);
        video.addEventListener('loadeddata', listener, { once: true });
        return;
      }

      this.clearDeferredMediaListener(video);
      const shouldStartHidden = this.mediaObserver ? this.mediaObserver.shouldStartHidden(video) : false;

      video.vsc = new VideoController(
        video,
        parent,
        this.config,
        this.actionHandler,
        shouldStartHidden
      );
    } catch (error) {
      logger.error(`Failed to attach controller: ${error.message}`);
    }
  }

  onVideoRemoved(video) {
    try {
      this.clearDeferredMediaListener(video);
      if (video.vsc) {
        video.vsc.remove();
      }
    } catch (error) {
      logger.error(`Failed to remove controller: ${error.message}`);
    }
  }

  clearDeferredMediaListener(video) {
    const listener = this.deferredMediaListeners.get(video);
    if (!listener) return;
    video.removeEventListener('loadeddata', listener);
    this.deferredMediaListeners.delete(video);
  }

  clearDeferredMediaListeners() {
    for (const [video, listener] of this.deferredMediaListeners) {
      video.removeEventListener('loadeddata', listener);
    }
    this.deferredMediaListeners.clear();
  }

  teardown() {
    this.acceptingMedia = false;
    this.runtimeAbort.abort();
    this._startupCancel?.();
    this._startupCancel = null;
    this._readyCancel?.();
    this._readyCancel = null;

    if (this._fallbackScanTimer) {
      clearTimeout(this._fallbackScanTimer);
      this._fallbackScanTimer = 0;
    }

    this.clearDeferredMediaListeners();
    this.config.teardownStorageListener();

    if (!this.initialized) return;

    logger.info('Tearing down Video Speed Controller');

    const videos = stateManager.getAllMediaElements();
    for (let i = 0; i < videos.length; i++) {
      if (videos[i].vsc) {
        videos[i].vsc.remove();
      }
    }

    this.mutationObserver?.stop();
    this.mutationObserver = null;

    this.eventManager?.cleanup();
    this.eventManager = null;

    siteHandlerManager.cleanup();

    if (document.adoptedStyleSheets) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (s) => s !== this._controllerSheet
      );
    }
    this._controllerSheet = null;
    this.actionHandler = null;
    this.mediaObserver = null;
    this.initialized = false;
  }
}


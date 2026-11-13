import { findMediaElements } from '../utils/dom-utils.js';
import { logger } from '../utils/logger.js';
import { stateManager } from '../core/state-manager.js';

export class VideoMutationObserver {
  constructor(config, onVideoFound, onVideoRemoved, mediaObserver) {
    this.config = config;
    this.onVideoFound = onVideoFound;
    this.onVideoRemoved = onVideoRemoved;
    this.mediaObserver = mediaObserver;

    this.observer = null;
    this.shadowObservers = new Map(); // Map<ShadowRoot, MutationObserver> — zero leaks on stop()
    this.pendingNodes = new Set();
    this.scanScheduled = false;
    this.scanTimerId = 0;
    this.useIdleCallback = false;
  }

  start(doc) {
    if (this.observer) return;
    const target = doc.body || doc.documentElement;
    if (!target) return;

    this.observer = new MutationObserver((mutations) => this.processMutations(mutations));
    this.observer.observe(target, {
      attributeFilter: ['aria-hidden', 'data-focus-method'],
      childList: true,
      subtree: true,
    });

    // Attach observers to existing open ShadowRoots
    this.discoverShadowRoots(target);
    logger.debug('VideoMutationObserver started');
  }

  discoverShadowRoots(root) {
    const doc = root.ownerDocument || (root.nodeType === 9 ? root : document);
    const walker = doc.createTreeWalker(root, 1 /* SHOW_ELEMENT */);
    let node = walker.nextNode();
    while (node) {
      if (node.tagName !== 'VSC-CONTROLLER' && node.shadowRoot) {
        this.observeShadowRoot(node.shadowRoot);
      }
      node = walker.nextNode();
    }
  }

  observeShadowRoot(shadowRoot) {
    if (!shadowRoot || this.shadowObservers.has(shadowRoot)) return;
    const shadowObs = new MutationObserver((mutations) => this.processMutations(mutations));
    shadowObs.observe(shadowRoot, {
      attributeFilter: ['aria-hidden'],
      childList: true,
      subtree: true,
    });
    this.shadowObservers.set(shadowRoot, shadowObs);
    this.discoverShadowRoots(shadowRoot);
  }

  unobserveShadowRoot(shadowRoot) {
    const obs = this.shadowObservers.get(shadowRoot);
    if (obs) {
      obs.disconnect();
      this.shadowObservers.delete(shadowRoot);
    }
  }

  processMutations(mutations) {
    const audioEnabled = Boolean(this.config.settings.audioBoolean);

    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      if (m.target?.tagName === 'VSC-CONTROLLER') continue;

      if (m.type === 'attributes') {
        if (m.attributeName === 'aria-hidden' && m.target instanceof Element) {
          this.handleAriaHiddenChange(m.target, audioEnabled);
        }
        continue;
      }

      if (m.type === 'childList') {
        for (let j = 0; j < m.addedNodes.length; j++) {
          const added = m.addedNodes[j];
          if (added.nodeType === 1 && added.tagName !== 'VSC-CONTROLLER') {
            this.pendingNodes.add(added);
          }
        }
        for (let j = 0; j < m.removedNodes.length; j++) {
          const removed = m.removedNodes[j];
          if (removed.nodeType === 1 && removed.tagName !== 'VSC-CONTROLLER') {
            this.handleRemovedSubtree(removed);
          }
        }
      }
    }

    if (this.pendingNodes.size > 0 && !this.scanScheduled) {
      this.scheduleScan();
    }
  }

  handleAriaHiddenChange(target, audioEnabled) {
    const revealed = target.getAttribute('aria-hidden') === 'false' || !target.hasAttribute('aria-hidden');
    if (!revealed) return;

    const mediaList = findMediaElements(target, audioEnabled);
    for (let i = 0; i < mediaList.length; i++) {
      const media = mediaList[i];
      if (!media.vsc) {
        this.onVideoFound(media, media.parentElement || media.parentNode);
      } else {
        media.vsc.updateVisibility();
      }
    }
  }

  handleRemovedSubtree(node) {
    const stack = [node];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur || cur.nodeType !== 1) continue;

      if ((cur.tagName === 'VIDEO' || cur.tagName === 'AUDIO') && cur.vsc && !cur.isConnected) {
        this.onVideoRemoved(cur);
      }
      if (cur.shadowRoot) {
        if (!cur.isConnected) {
          this.unobserveShadowRoot(cur.shadowRoot);
        }
        stack.push(cur.shadowRoot);
      }
      let child = cur.firstElementChild;
      while (child) {
        if (child.tagName !== 'VSC-CONTROLLER') {
          stack.push(child);
        }
        child = child.nextElementSibling;
      }
    }
  }

  scheduleScan() {
    this.scanScheduled = true;
    const run = () => {
      this.scanScheduled = false;
      this.scanTimerId = 0;
      if (this.pendingNodes.size === 0) return;

      const audioEnabled = Boolean(this.config.settings.audioBoolean);
      const batch = [...this.pendingNodes];
      this.pendingNodes.clear();

      for (let i = 0; i < batch.length; i++) {
        const root = batch[i];
        if (!root.isConnected) continue;

        this.discoverShadowRoots(root);
        const found = findMediaElements(root, audioEnabled);
        for (let j = 0; j < found.length; j++) {
          const media = found[j];
          if (!media.vsc && media.isConnected) {
            this.onVideoFound(media, media.parentElement || media.parentNode);
          }
        }
      }

      // Prune any orphaned controllers whose video disappeared via outer DOM wipe
      const tracked = stateManager.controllers;
      for (const [, info] of tracked) {
        if (info.element && !info.element.isConnected) {
          this.onVideoRemoved(info.element);
        }
      }
    };

    if (typeof requestIdleCallback === 'function') {
      this.useIdleCallback = true;
      this.scanTimerId = requestIdleCallback(run, { timeout: 120 });
    } else {
      this.useIdleCallback = false;
      this.scanTimerId = setTimeout(run, 16);
    }
  }

  stop() {
    if (this.scanTimerId) {
      if (this.useIdleCallback && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(this.scanTimerId);
      } else {
        clearTimeout(this.scanTimerId);
      }
      this.scanTimerId = 0;
    }
    this.scanScheduled = false;
    this.pendingNodes.clear();

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    for (const shadowObs of this.shadowObservers.values()) {
      shadowObs.disconnect();
    }
    this.shadowObservers.clear();

    logger.debug('VideoMutationObserver stopped cleanly');
  }
}


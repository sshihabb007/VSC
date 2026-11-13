import { logger } from './logger.js';

export function inIframe() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Find nearest ancestor container matching the media element's box size.
 */
export function findVideoParent(element) {
  let parentElement = element.parentElement;
  if (!parentElement) return element;

  while (
    parentElement.parentElement &&
    parentElement.parentElement.offsetHeight === parentElement.offsetHeight &&
    parentElement.parentElement.offsetWidth === parentElement.offsetWidth
  ) {
    parentElement = parentElement.parentElement;
  }

  return parentElement;
}

/**
 * Invoke callback once document is complete without leaving dangling listeners.
 */
export function initializeWhenReady(doc, callback) {
  if (!doc) return () => {};
  if (doc.readyState === 'complete') {
    callback(doc);
    return () => {};
  }

  let called = false;
  const run = () => {
    if (called) return;
    called = true;
    window.removeEventListener('load', run);
    doc.removeEventListener('readystatechange', onReadyState);
    callback(doc);
  };
  const onReadyState = () => {
    if (doc.readyState === 'complete') {
      run();
    }
  };

  window.addEventListener('load', run, { once: true });
  doc.addEventListener('readystatechange', onReadyState);

  return () => {
    called = true;
    window.removeEventListener('load', run);
    doc.removeEventListener('readystatechange', onReadyState);
  };
}

/**
 * Iterative, zero-recursion shadow-aware search for <video> / <audio> elements.
 * Deduplicates results cleanly across nested shadow roots.
 */
export function findMediaElements(root, audioEnabled = false, maxDepth = 10) {
  if (!root) return [];

  const selector = audioEnabled ? 'video,audio' : 'video';
  const found = [];
  const seenMedia = new Set();
  const stack = [{ node: root, depth: 0 }];

  const addMedia = (el) => {
    if (!seenMedia.has(el)) {
      seenMedia.add(el);
      found.push(el);
    }
  };

  while (stack.length > 0) {
    const { node, depth } = stack.pop();
    if (!node || depth > maxDepth) continue;

    if (node.nodeType === 1 /* ELEMENT_NODE */) {
      if (node.tagName === 'VIDEO' || (audioEnabled && node.tagName === 'AUDIO')) {
        addMedia(node);
      }
      if (node.shadowRoot && depth < maxDepth) {
        stack.push({ node: node.shadowRoot, depth: depth + 1 });
      }
    }

    if (typeof node.querySelectorAll === 'function') {
      const directMedia = node.querySelectorAll(selector);
      for (let i = 0; i < directMedia.length; i++) {
        addMedia(directMedia[i]);
      }

      if (depth < maxDepth) {
        // Walk elements in the current root to discover open ShadowRoots
        const doc = node.ownerDocument || (node.nodeType === 9 ? node : document);
        const walker = doc.createTreeWalker(node, 1 /* NodeFilter.SHOW_ELEMENT */);
        let cur = walker.nextNode();
        while (cur) {
          if (cur.shadowRoot) {
            stack.push({ node: cur.shadowRoot, depth: depth + 1 });
          }
          cur = walker.nextNode();
        }
      }
    }
  }

  if (logger.isEnabled(6 /* VERBOSE */)) {
    logger.verbose(`findMediaElements located ${found.length} elements`);
  }
  return found;
}

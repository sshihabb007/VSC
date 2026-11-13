import { formatSpeed } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

const SHADOW_CSS = `
* {
  line-height: 1.6em;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-sizing: border-box;
}

@keyframes vscControlsReveal {
  from {
    opacity: 0;
    transform: translate3d(-4px, 0, 0) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

/* Automatic hide layer (lowest override precedence) */
:host(.vsc-hidden) #controller {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
}

/* Explicit show override & flash outrank automatic/site autohide */
:host([data-vsc-visibility="show"]) #controller,
:host(.vsc-show) #controller {
  display: inline-flex !important;
  visibility: visible !important;
  opacity: var(--vsc-opacity, 0.3) !important;
}

/* Explicit hide & missing-source are final */
:host([data-vsc-visibility="hide"]) #controller,
:host(.vsc-nosource) #controller {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
}

#controller {
  position: absolute;
  top: var(--vsc-anchor-y, 12px);
  left: var(--vsc-anchor-x, 12px);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: rgba(12, 14, 18, 0.86);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #f8fafc;
  border-radius: 8px;
  padding: 3px 5px;
  margin: 0;
  pointer-events: auto;
  cursor: default;
  z-index: 9999999;
  white-space: nowrap;
  opacity: var(--vsc-opacity, 0.3);
  transform: translate3d(
    calc(var(--vsc-align-x, 0%) + var(--vsc-tx, 0px)),
    calc(var(--vsc-align-y, 0%) + var(--vsc-ty, 0px)),
    0
  );
  will-change: transform, opacity;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
  transition: opacity 0.16s cubic-bezier(0.22, 1, 0.36, 1),
              background-color 0.16s ease,
              box-shadow 0.16s ease;
}

#controller:hover,
#controller.dragging {
  opacity: 0.92 !important;
  background: rgba(14, 17, 23, 0.94);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.38);
}

#controller.dragging {
  cursor: grabbing;
}

:host(:hover) #controls,
#controller:hover #controls,
#controller.dragging #controls {
  display: inline-flex;
  align-items: center;
  animation: vscControlsReveal 0.14s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

#controller:hover > .draggable,
#controller.dragging > .draggable {
  margin-right: 4px;
}

#controls {
  display: none;
  align-items: center;
  gap: 2px;
  font-size: var(--vsc-font-size, 14px);
  line-height: 1;
}

.draggable {
  cursor: grab;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.85em;
  height: 1.45em;
  padding: 0 4px;
  font-size: var(--vsc-font-size, 14px);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-align: center;
  touch-action: none;
  border-radius: 5px;
  transition: background-color 0.12s ease;
}

.draggable:hover {
  background: rgba(255, 255, 255, 0.1);
}

.draggable:active {
  cursor: grabbing;
}

button {
  appearance: none;
  cursor: pointer;
  color: #0f172a;
  background: #f8fafc;
  font-weight: 600;
  border-radius: 5px;
  padding: 2px 6px;
  min-width: 1.65em;
  height: 1.45em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: inherit;
  line-height: 1;
  border: 0;
  font-family: ui-monospace, SFMono-Regular, "Lucida Console", Monaco, monospace;
  margin: 0;
  transition: background-color 0.12s ease, color 0.12s ease, transform 0.08s ease;
}

button:focus {
  outline: none;
}

button:hover {
  background: #ef4444;
  color: #ffffff;
}

button:active {
  background: #dc2626;
  color: #ffffff;
  transform: scale(0.94);
}

button.rw {
  opacity: 0.78;
}

button.rw:hover {
  opacity: 1;
}
`;

let sharedStyleSheet = null;

function getSharedStyleSheet() {
  if (!sharedStyleSheet && typeof CSSStyleSheet === 'function') {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(SHADOW_CSS);
    sharedStyleSheet = sheet;
  }
  return sharedStyleSheet;
}

const BUTTON_SPECS = Object.freeze([
  { action: 'rewind', text: '«', cls: 'rw' },
  { action: 'slower', text: '−', cls: '' },
  { action: 'faster', text: '+', cls: '' },
  { action: 'advance', text: '»', cls: 'rw' },
]);

export class ShadowDOMManager {
  static createShadowDOM(wrapper, options = {}) {
    const {
      speed = '1.00',
      opacity = 0.3,
      buttonSize = 14,
    } = options;

    const shadow = wrapper.attachShadow({ mode: 'open' });
    const sheet = getSharedStyleSheet();

    if (sheet && 'adoptedStyleSheets' in shadow) {
      shadow.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement('style');
      style.textContent = SHADOW_CSS;
      shadow.appendChild(style);
    }

    const controller = document.createElement('div');
    controller.id = 'controller';
    controller.style.setProperty('--vsc-opacity', String(opacity));
    controller.style.setProperty('--vsc-font-size', `${buttonSize}px`);

    const draggable = document.createElement('span');
    draggable.setAttribute('data-action', 'drag');
    draggable.className = 'draggable';
    draggable.textContent = speed;
    controller.appendChild(draggable);

    const controls = document.createElement('span');
    controls.id = 'controls';

    for (let i = 0; i < BUTTON_SPECS.length; i++) {
      const spec = BUTTON_SPECS[i];
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-action', spec.action);
      if (spec.cls) button.className = spec.cls;
      button.textContent = spec.text;
      controls.appendChild(button);
    }

    controller.appendChild(controls);
    shadow.appendChild(controller);

    logger.debug('Shadow DOM created for video controller');
    return shadow;
  }

  static updateAppearance(shadow, { opacity, buttonSize }) {
    const controller = shadow?.querySelector('#controller');
    if (!controller) return;
    if (typeof opacity === 'number' && Number.isFinite(opacity)) {
      controller.style.setProperty('--vsc-opacity', String(opacity));
    }
    if (typeof buttonSize === 'number' && Number.isFinite(buttonSize)) {
      controller.style.setProperty('--vsc-font-size', `${buttonSize}px`);
    }
  }

  static applyPosition(shadow, coords) {
    const controller = shadow?.querySelector('#controller');
    if (!controller || !coords) return;
    controller.style.setProperty('--vsc-anchor-x', coords.anchorX);
    controller.style.setProperty('--vsc-anchor-y', coords.anchorY);
    controller.style.setProperty('--vsc-align-x', coords.alignX);
    controller.style.setProperty('--vsc-align-y', coords.alignY);
  }

  static getController(shadow) {
    return shadow.querySelector('#controller');
  }

  static getControls(shadow) {
    return shadow.querySelector('#controls');
  }

  static getSpeedIndicator(shadow) {
    return shadow.querySelector('.draggable');
  }

  static getButtons(shadow) {
    return shadow.querySelectorAll('button');
  }

  static updateSpeedDisplay(shadow, speed) {
    const indicator = this.getSpeedIndicator(shadow);
    if (indicator) {
      indicator.textContent = formatSpeed(speed);
    }
  }

  static calculatePosition(video) {
    const rect = video.getBoundingClientRect();
    const offsetRect = video.offsetParent?.getBoundingClientRect();
    const top = `${Math.max(rect.top - (offsetRect?.top || 0), 0)}px`;
    const left = `${Math.max(rect.left - (offsetRect?.left || 0), 0)}px`;
    return { top, left };
  }
}


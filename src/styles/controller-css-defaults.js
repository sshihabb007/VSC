/**
 * Built-in domain-scoped autohide & overlay safety rules.
 * Non-matching :root[style*='--vsc-domain: "..."'] rules are stripped completely at
 * CSSOM adoption time to prevent selector/attribute invalidation overhead on unrelated sites.
 */

export const DEFAULT_CONTROLLER_CSS = `/* YouTube autohide (explicit show / flash outranks site autohide) */
:root[style*='--vsc-domain: "youtube.com"'] .ytp-autohide vsc-controller:not([data-vsc-visibility="show"]):not(.vsc-show) {
  visibility: hidden !important;
  opacity: 0 !important;
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.2s linear;
}

:root[style*='--vsc-domain: "youtube-nocookie.com"'] .ytp-autohide vsc-controller:not([data-vsc-visibility="show"]):not(.vsc-show) {
  visibility: hidden !important;
  opacity: 0 !important;
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.2s linear;
}

/* OpenAI / Amazon Prime full-screen blank overlay guards */
.Shared-Video-player > vsc-controller {
  height: 0 !important;
}

.dv-player-fullscreen vsc-controller {
  height: 0 !important;
}`;

const DOMAIN_RULE_RE = /(?::root)+\[style\*='--vsc-domain:\s*"([^"]+)"'\]([^{]*)\{([^}]*)\}/g;

export function preprocessDomainCSS(css, hostname = '') {
  if (!css) return '';
  const normalizedHost = hostname.replace(/^www\./, '');
  return css.replace(DOMAIN_RULE_RE, (match, domain, selector, body) => {
    if (domain !== normalizedHost) {
      return '';
    }
    const prefix = match.startsWith(':root:root') ? ':root ' : '';
    return `${prefix}${selector.trim()} {${body}}`;
  });
}


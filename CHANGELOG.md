# Changelog

All notable changes to **Video Speed Controller** are documented in this file.

## [1.0.2] - 2026-11-14

### Changed
- **Refined Out-of-the-Box Default Appearance & Positioning**:
  - Updated default **Controller button size** from `14px` to compact **`8px`** (`controllerOpacity: 0.3`, `Console Log Level: Warning`, and disabled default site rules for `imgur.com`, `teams.microsoft.com`, and `meet.google.com`).
  - Updated **Global Default** controller position to **`Top-Left` (`Offset X: 0px`, `Offset Y: +50px`)** so the speed badge clears top player bars and titles cleanly.
  - Updated built-in platform positioning presets: **YouTube**, **Instagram**, and **X (Twitter)** default to **`Top-Left` (`X: 0px`, `Y: +50px`)**, and **Facebook** defaults to **`Top-Left` (`X: 0px`, `Y: +60px`)**.
- **Platform-Aware Position Reset & Customization State**: Updated `PositionStudio` (**Reset Current Site** and pill customization dots) and Popup quick position reset (`getDefaultPositionForSite`) to restore each platform's own built-in preset rather than zeroing offsets.

## [1.0.1] - 2026-11-14

### Fixed
- **Chrome Extensions Manager Warning on Facebook (`[VSC] Facebook DOM structure changed, using fallback positioning`)**: Replaced the brittle unconditional 7-level `parentElement` climb in `FacebookHandler.getControllerPosition()` with bounded player-container resolution that prefers explicit Facebook player roots (`[data-video-id]`, `.video-container`, `.fbStoryVideoContainer`), stops before `<body>`/`<html>`, semantic feed/article/dialog boundaries (`role="feed"`, `role="article"`, `role="main"`, `role="dialog"`), and oversized feed columns (`getBoundingClientRect()`), and logs shallow/detached fallbacks at `debug` level instead of `console.warn`.
- **Expanded Facebook Domain Coverage**: Updated `FacebookHandler.matches()` to match `facebook.com`, `*.facebook.com` (`www`, `m`, `web`), and `fb.watch` consistently with built-in platform positioning presets.
- **Root DOM Boundary Protection Across All Site Handlers**: Added `BaseSiteHandler.getSafeParentNode()` and hardened `VideoController.insertIntoDOM()` plus `YouTubeHandler`, `NetflixHandler`, `AmazonHandler`, `AppleHandler`, `DailymotionHandler`, and `FrameHandler` so `<vsc-controller>` never climbs onto `<html>`/`#document` or inserts outside `<body>` while preserving `ShadowRoot` container support.
- **Extension Reload & Runtime Error Hardening**: Handled asynchronous `Extension context invalidated` Promise rejections on `chrome.storage.sync.set()`/`get()` in `content-bridge.js`, added `.catch()` and `chrome.runtime.lastError` guards across `popup.js`, and demoted non-fatal fail-closed/action diagnostics in `storage-manager.js` and `action-handler.js` to `debug`.
- **Regression & Browser E2E Coverage**: Added unit boundary tests for `FacebookHandler`, sibling site handlers, and `VideoController.insertIntoDOM`, and tightened Chromium/Brave E2E assertions to fail on any `[VSC]` `console.warn` output.

## [1.0.0] - 2026-11-13

### Added
- **Manifest V3 Lightweight Runtime**: Low-overhead HTML5 `<video>` and `<audio>` speed controller (`0.07×`–`16.00×`) using Shadow DOM isolation, shared constructable `CSSStyleSheet`, `ResizeObserver`, and GPU-composited `translate3d` positioning.
- **Per-Platform & Site-Wise Controller Positioning Studio**: Configure independent corners/edges, directional nudges (`Up`, `Down`, `Left`, `Right` at `1px`/`5px`/`10px`/`25px`), and explicit pixel offsets for Global Default, YouTube, Facebook, Instagram, X (Twitter), and custom domains or `/regex/` patterns with a 16:9 live preview stage (`Options > Advanced`) and Popup quick positioning.
- **Speed Arbitration & Intent Classification**: Prevents player rate fights, isolates SPA route changes, and protects text/Shadow DOM input typing.
- **Custom Logo & Icon Set**: `512×512` master logo (`assets/logo.png`) and full active/disabled PNG icon suite (`16`–`128px`) across the toolbar, Popup HUD, Options header, and About hero.
- **In-Extension About & Help Hub**: Combined usage guide, keyboard shortcut table, positioning guide, developer links, and FAQs inside `Options > About`.
- **Default Keyboard Shortcuts**:
  - `X` Decrease speed (`0.1×`), `C` Increase speed (`0.1×`), `S` Rewind (`5s`), `D` Advance (`5s`), `Z` Reset speed (`1.0×`), `G` Preferred speed (`1.6×`), `V` Show/hide controller, `M` Set marker, `J` Jump to marker.

<p align="center">
  <img src="assets/logo.png" alt="Video Speed Controller Logo" width="128" />
</p>

<h1 align="center">Video Speed Controller</h1>

<p align="center">
  <strong>Lightweight, Manifest V3 HTML5 <code>&lt;video&gt;</code> &amp; <code>&lt;audio&gt;</code> speed controller for Google Chrome &amp; Brave Browser.</strong>
</p>

<p align="center">
  <a href="https://github.com/sshihabb007/VSC/releases/latest">
    <img src="https://img.shields.io/github/v/release/sshihabb007/VSC?style=flat-square&color=e11d48&label=Release" alt="Latest Release" />
  </a>
  <img src="https://img.shields.io/badge/Manifest-V3-2563eb?style=flat-square" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Permission-storage%20only-10b981?style=flat-square" alt="Minimal Storage Permission" />
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-a855f7?style=flat-square" alt="MIT License" />
  </a>
</p>

Engineered for minimal runtime overhead, Shadow DOM isolation, SPA navigation resilience, intelligent playback-rate arbitration, and live **per-platform / site-wise controller positioning** with zero custom CSS needed.

---

## Features & Engineering Highlights

- **Per-Platform & Site-Wise Controller Positioning Studio** *(No Custom CSS Required)*
  - Configure independent controller placements for **Global Default**, **YouTube**, **Facebook**, **Instagram**, **X (Twitter)**, or any custom domain / `/regex/` pattern.
  - Anchor the floating badge to any corner or edge (**Top-Left**, **Top**, **Top-Right**, **Left**, **Right**, **Bottom-Left**, **Bottom**, **Bottom-Right**).
  - Fine-tune position with **Directional Nudge Controls** (**Up**, **Down**, **Left**, **Right**) using `1px`, `5px`, `10px`, or `25px` steps and explicit `Offset X` / `Offset Y` pixel inputs.
  - Real-time **16:9 Live Preview Stage** in `Options > Advanced > Controller Positioning` plus **Current-Site Quick Positioning** directly inside the extension popup — applies live across open video tabs without reloading.
- **Smooth & Lightweight Overlay Architecture**
  - Shadow DOM isolation backed by a single shared constructable `CSSStyleSheet` and GPU-composited `translate3d` dragging & alignment.
  - `ResizeObserver` and fullscreen-aware anchoring keep the speed badge pinned accurately inside responsive players without altering page layout.
  - Strictly minimal Manifest V3 `"storage"` permission — zero analytics, zero external network calls.
- **Precision Playback Control & Conflict Resolution**
  - Continuous playback speed from `0.07×` to `16.00×` with smart `1.00×` snapping.
  - Hover over the badge for inline buttons (`«` Rewind, `−` Slower, `+` Faster, `»` Advance), hover + mouse wheel for quick stepping, double-click to toggle preferred speed, or hold and drag to reposition on the fly.
  - Speed arbiter + intent classifier automatically detects hostile site player rate-resets (without breaking legitimate seeks) and suppresses false feedback loops.
  - Built-in **Options > About** tab with complete usage guides, shortcut reference, developer links, and FAQs.

---

## Installation (Chrome & Brave)

### Option 1: Download Pre-Built Release *(Recommended)*

1. Download **`VideoSpeedController-v1.0.0.zip`** from the [**Latest GitHub Release**](https://github.com/sshihabb007/VSC/releases/latest).
2. Extract the archive into a local folder on your computer.
3. Open your browser's extensions page:
   - **Google Chrome:** `chrome://extensions`
   - **Brave Browser:** `brave://extensions`
4. Toggle on **Developer mode** in the top-right corner.
5. Click **Load unpacked** and select the extracted folder (containing `manifest.json`).

### Option 2: Build from Source

```bash
git clone https://github.com/sshihabb007/VSC.git
cd VSC
npm install
npm run build:prod
```

Load the generated `dist/` directory in `chrome://extensions` or `brave://extensions` via **Load unpacked**.

---

## Default Keyboard Shortcuts

| Key | Action | Default Value |
| :--- | :--- | :--- |
| `X` | Decrease speed | `-0.1×` |
| `C` | Increase speed | `+0.1×` |
| `S` | Rewind | `5s` |
| `D` | Advance | `5s` |
| `Z` | Reset playback speed | `1.0×` |
| `G` | Toggle preferred speed | `1.6×` |
| `V` | Show / hide overlay controller | — |
| `M` | Set timestamp marker | — |
| `J` | Jump to timestamp marker | — |

All shortcuts can be customized or bound with `Ctrl` / `Alt` / `Shift` / `Meta` chords — alongside extra actions (`Pause`, `Mute`, `Increase volume`, `Decrease volume`) — in **Extension Options > Settings**.

---

## Controller Positioning Guide

1. **Full Positioning Studio (`Options > Advanced > Controller Positioning`)**
   - Choose **Global Default**, **YouTube**, **Facebook**, **Instagram**, **X (Twitter)**, or add any custom website/regex via **+ Add Site**.
   - Click any perimeter dot on the **16:9 Live Preview Stage** or pick an anchor from the **Anchor To Corner or Edge** matrix.
   - Nudge `Up`, `Down`, `Left`, `Right` (`1px`/`5px`/`10px`/`25px`) or enter exact `Offset X` / `Offset Y` pixels, then click **Save** to sync live across matching tabs.
2. **Popup Quick Site Positioning**
   - Open the toolbar popup on any tab to switch anchor corners/edges or nudge offsets (`10px` steps) live on the page, or click **Studio** to open that site directly in Options.
3. **Temporary On-Video Dragging**
   - Drag the floating badge anywhere over a video player during playback.

---

## Development, Packaging & Testing

```bash
# Regenerate PNG icons (16px..128px + disabled variants) from assets/logo.png
npm run icons

# Development build -> dist/
npm run build

# Minified production build -> dist/
npm run build:prod

# Build minified extension + zip package -> release/VideoSpeedController-v<version>.zip
npm run package

# Run unit & integration suite
npm run test:unit

# Run live Chrome & Brave E2E extension verification
npm run test:e2e

# Full build + unit + E2E test pipeline
npm test
```

### Project Layout

```text
VSC/
├── .github/workflows/            # CI verification & tagged GitHub Release automation
├── manifest.json                 # MV3 extension manifest
├── package.json                  # Build, packaging & test scripts
├── CHANGELOG.md                  # Release history
├── LICENSE                       # MIT License
├── assets/
│   ├── logo.png                  # Master extension logo (512x512 transparent PNG)
│   └── icons/                    # Active & disabled PNG icon set (16px..128px)
├── scripts/
│   ├── build.mjs                 # esbuild bundler & asset pipeline
│   ├── generate-icons.mjs        # Lanczos-2 PNG icon generator from assets/logo.png
│   └── package.mjs               # Zero-dependency production ZIP packager -> release/
├── src/
│   ├── background.js             # Service worker lifecycle, v2 migration & toolbar icons
│   ├── entries/                  # Content bridge & MAIN-world inject entry points
│   ├── core/                     # Speed arbitration, intent classifier, settings, positioning
│   ├── observers/                # Mutation & media discovery observers
│   ├── site-handlers/            # YouTube, Facebook, Netflix & base player handlers
│   ├── styles/                   # Host stylesheet & domain autohide CSS guards
│   ├── ui/                       # Shadow DOM, drag handler, Options Studio, About & Popup UI
│   └── utils/                    # Constants, logger, site pattern matcher, key maps
└── tests/
    ├── unit-and-integration.test.mjs
    └── e2e-browser.mjs
```

---

## Author & Developer

- **Name:** Mehedi Hasan Shihab (`@sshihabb007`)
- **Role:** Software & Systems Engineer
- **GitHub:** [github.com/sshihabb007](https://github.com/sshihabb007)
- **Portfolio:** [sshihabb007.github.io](https://sshihabb007.github.io/)
- **LinkedIn:** [linkedin.com/in/mehedi-hasan-shihab](https://www.linkedin.com/in/mehedi-hasan-shihab)
- **Email:** `sshihabb007@gmail.com`

---

## License

Licensed under the [MIT License](LICENSE).

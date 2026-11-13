# Changelog

All notable changes to **Video Speed Controller** are documented in this file.

## [1.0.0] - 2026-11-13

### Added
- **Manifest V3 Lightweight Runtime**: Low-overhead HTML5 `<video>` and `<audio>` speed controller (`0.07×`–`16.00×`) using Shadow DOM isolation, shared constructable `CSSStyleSheet`, `ResizeObserver`, and GPU-composited `translate3d` positioning.
- **Per-Platform & Site-Wise Controller Positioning Studio**: Configure independent corners/edges, directional nudges (`Up`, `Down`, `Left`, `Right` at `1px`/`5px`/`10px`/`25px`), and explicit pixel offsets for Global Default, YouTube, Facebook, Instagram, X (Twitter), and custom domains or `/regex/` patterns with a 16:9 live preview stage (`Options > Advanced`) and Popup quick positioning.
- **Speed Arbitration & Intent Classification**: Prevents player rate fights, isolates SPA route changes, and protects text/Shadow DOM input typing.
- **Custom Logo & Icon Set**: `512×512` master logo (`assets/logo.png`) and full active/disabled PNG icon suite (`16`–`128px`) across the toolbar, Popup HUD, Options header, and About hero.
- **In-Extension About & Help Hub**: Combined usage guide, keyboard shortcut table, positioning guide, developer links, and FAQs inside `Options > About`.
- **Default Keyboard Shortcuts**:
  - `X` Decrease speed (`0.1×`), `C` Increase speed (`0.1×`), `S` Rewind (`5s`), `D` Advance (`5s`), `Z` Reset speed (`1.0×`), `G` Preferred speed (`1.6×`), `V` Show/hide controller, `M` Set marker, `J` Jump to marker.

# Shopping List branding

Shopping List has its own shopping-cart SVG mark, adapted from the original app icon with rounded strokes, a simple basket, and two wheels. It uses Tendstead purple `#6750A4` to match the shared UI.

- `web/static/shopping-list-mark.svg`: purple cart on a transparent background for the app shell.
- `web/static/icon.svg`: matching white cart on a rounded purple tile for the browser favicon and installed app.
- `web/static/tendstead-mark.svg`: supplied organization roof-and-sprout artwork, retained separately from the product mark.

`@tendstead/ui@0.1.0` does not expose a custom brand-image prop, so the app replaces its decorative mark with a local CSS background. No package files are modified.

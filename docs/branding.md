# Shopping List branding

The shell uses `web/static/tendstead-mark.svg` in place of the shared UI library's default decorative “t”. The browser favicon and installed-app icon use `web/static/icon.svg`.

These are unchanged copies of `tendstead-mark.svg` and `tendstead-avatar.svg` from the organization's supplied `tendstead-brand` asset folder. Their source README describes original, text-authored SVG artwork: a shelter roof over a sprout, using Tendstead purple `#6750A4`.

`@tendstead/ui@0.1.0` does not expose a custom brand-image prop, so the app replaces its decorative mark with a local CSS background. No package files are modified.

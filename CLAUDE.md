# Iron Island (fitness-tracker) — how to update

- `app.html` is the single source for the app. It is identical to Jason's Claude artifact
  "Fitness Tracker" (slug 1d6b40c5-127e-45bb-bbc1-37a53f93ff55, file `index.html`; that artifact
  also has `baseline/iron-island-ui-v15.txt`, keep it).
- Inside Claude the app saves through `window.claude.use('db'|'user')`. On GitHub Pages,
  `firebase-bridge.js` provides the same API on Firebase (project fitness-tracker-2da98) with
  per-user AES-GCM encryption (key derived from the user's recovery key via HKDF; vault check doc
  at users/{uid}/meta/vault). Never add code that sends recovery keys or plaintext anywhere.
- Photos: meta in users/{uid}/photos, image bytes in users/{uid}/photoData, loaded on demand via
  `window.__ironPhoto(id)`.

## Update steps
1. Edit `app.html` (and/or `firebase-bridge.js`).
2. `python3 tools/build.py` to regenerate `index.html`. Never hand-edit `index.html`.
3. Commit and push to `main`; GitHub Pages redeploys in about a minute.
4. Republish the Claude artifact from the same `app.html` (served as `index.html`) so both match.

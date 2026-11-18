# Iron Island

A fitness tracker for weigh-ins, progress photos and lifts.

**Open it:** https://jmichael-17.github.io/fitness-tracker/

On iPhone, open the link in Safari, tap **Share → Add to Home Screen**, then open it from the icon.

## Privacy
Sign in with Google to keep your data on every device. Everything you log is encrypted on your own phone with your recovery key before it is saved, so the person running this app can't read it. Keep your recovery key safe: without it, your data can't be recovered by anyone.

You can also use the app without an account. Then your data stays on that one phone and browser.

## Files
- `app.html`: the app itself (the same file as the Claude artifact)
- `firebase-bridge.js`: sign-in, encryption and saving to Firebase
- `index.html`: built from the two files above by `python3 tools/build.py`; don't edit it by hand

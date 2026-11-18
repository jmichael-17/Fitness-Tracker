"""Builds index.html for GitHub Pages from app.html (the same file the Claude artifact uses).
Run: python3 tools/build.py"""
import pathlib, hashlib
root = pathlib.Path(__file__).resolve().parent.parent
app = (root / "app.html").read_text(encoding="utf-8")
bridge_v = hashlib.sha256((root / "firebase-bridge.js").read_bytes()).hexdigest()[:10]
FB = "https://www.gstatic.com/firebasejs/10.14.1/"
head = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Iron Island</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#cfe6e3">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Iron Island">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.json">
<link rel="icon" type="image/png" href="icon-512.png">
<link rel="apple-touch-icon" href="icon-180.png">
<script src="{FB}firebase-app-compat.js"></script>
<script src="{FB}firebase-auth-compat.js"></script>
<script src="{FB}firebase-firestore-compat.js"></script>
<script src="firebase-bridge.js?v={bridge_v}"></script>
</head>
<body>
"""
(root / "index.html").write_text(head + app + "\n</body>\n</html>\n", encoding="utf-8")
print("built index.html")

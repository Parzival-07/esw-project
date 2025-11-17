# Browser Cache Fix Guide

## Why does this happen?
Browsers cache HTML, CSS, and JS files to load websites faster. When you make changes, the browser might still show old cached versions.

## Quick Fixes (Choose One)

### Method 1: Hard Refresh (Recommended)
- **Windows/Linux**: `Ctrl + Shift + R` or `Ctrl + F5`
- **Mac**: `Cmd + Shift + R`

### Method 2: Clear Browser Cache
1. Open browser DevTools: `F12` or `Right-click → Inspect`
2. Go to **Network** tab
3. Check "Disable cache" checkbox
4. Keep DevTools open while developing
5. Reload page: `F5`

### Method 3: Incognito/Private Mode
- **Chrome**: `Ctrl + Shift + N`
- **Firefox**: `Ctrl + Shift + P`
- **Edge**: `Ctrl + Shift + N`

This always loads fresh files without any cache.

### Method 4: Clear Service Worker (for PWA)
1. Open DevTools (`F12`)
2. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
3. Click **Service Workers** on the left
4. Click "Unregister" next to the service worker
5. Go to **Cache Storage**
6. Delete all caches
7. Refresh page

## Permanent Solution for Development

I've already added these to your files:

1. **Cache-Control headers** in `index.html`:
   ```html
   <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
   <meta http-equiv="Pragma" content="no-cache">
   <meta http-equiv="Expires" content="0">
   ```

2. **Version parameters** on CSS/JS files:
   ```html
   <link rel="stylesheet" href="style.css?v=1.2">
   <script src="script.js?v=1.2"></script>
   ```

3. **Updated Service Worker** version in `sw.js`:
   ```javascript
   const CACHE_NAME = 'motor-control-v1.2';
   ```

## When to Update Version
Each time you make significant changes:
1. Update `?v=1.2` to `?v=1.3` in `index.html`
2. Update `CACHE_NAME` in `sw.js`
3. Hard refresh browser

## For Production
Remove the cache-control meta tags before deploying to production, as they prevent proper caching benefits.

## VSCode Live Server Settings
If using Live Server extension, add to `.vscode/settings.json`:
```json
{
  "liveServer.settings.ignoreFiles": [
    ".vscode/**",
    "**/*.scss",
    "**/*.sass"
  ],
  "liveServer.settings.donotShowInfoMsg": true,
  "liveServer.settings.NoBrowser": false
}
```

Live Server should automatically reload when files change, but browser caching can still occur.

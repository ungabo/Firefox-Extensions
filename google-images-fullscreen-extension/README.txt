Google Images Fullscreen Preview v1.0.4

Temporary Firefox install:
1. Unzip this file.
2. Open about:debugging#/runtime/this-firefox
3. Click Load Temporary Add-on.
4. Select manifest.json from the extracted folder.

Toolbar button:
- Click the extension button to enable/disable it.
- Badge shows ON or OFF.

Private windows:
Firefox blocks extensions in private windows by default.
Go to about:addons, open this extension, and set Run in Private Windows to Allow.

Navigation:
- Click a Google Images result.
- The selected image should open in a fullscreen overlay.
- Use ArrowLeft / ArrowRight or the overlay chevrons to navigate.
- Press Esc or click the dark background to close.

Notes:
Google changes its image-search DOM frequently. This extension avoids hard-coded class names where possible, but future Google layout changes may still require selector updates.

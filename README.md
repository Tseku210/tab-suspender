# Tab Suspender

A minimal Chrome/Brave browser extension (Manifest V3) for manually putting tabs to sleep to free up memory without closing them.

[**➜ Install from the Chrome Web Store**](https://chromewebstore.google.com/detail/bfnnjnpffmmffhpodkcmageobbdapdkc)

![Tab Suspender popup showing a list of tabs with Sleep and Wake buttons](store/screenshot-1280x800.png)

## Demo

https://github.com/user-attachments/assets/30cf90ee-01ea-4eed-b647-cf6d624c21f7


## Features

- **Put individual tabs to sleep** — discard any inactive tab from the popup list
- **Sleep Others** — one-click discard of all non-active, non-pinned, non-audible tabs
- **Wake All** — restore every sleeping tab in the current window
- **Live tab list** — shows titles, hostnames, favicons, and status badges (Active / Asleep / Pinned / Playing)
- **Click to switch** — click any tab row to jump to it

## Install

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/bfnnjnpffmmffhpodkcmageobbdapdkc), or load it unpacked for development:

1. Clone this repository:

   ```bash
   git clone https://github.com/Tseku210/tab-suspender.git
   ```

2. Open `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select the cloned folder

## Files

- `manifest.json` — extension manifest (MV3)
- `popup.html` / `popup.js` — popup UI and tab management logic
- `icons/` — extension icons

# Chrome Web Store listing — Tab Suspender

## Name
Tab Suspender

## Summary (max 132 chars)
Manually put tabs to sleep to free up memory without closing them. One click, no tracking, no settings to learn.

## Description
Tab Suspender gives you a simple, manual way to reclaim memory from tabs you're not using — without losing them.

Open the popup to see every tab in the current window, then:

• Put any single tab to sleep with one click
• "Sleep Others" — keep the tab you're on, put everything else to sleep
• Sleep a whole tab group at once — the list shows your groups with their names and colors
• "Select" — pick exactly the tabs you want and put them to sleep together
• "Wake All" — bring every sleeping tab back instantly
• See a rough estimate of the memory your sleeping tabs have freed
• Click any tab in the list to jump straight to it

Sleeping tabs stay exactly where they are in your tab strip. Their title and icon remain visible, and they reload the moment you click them.

Tab Suspender is deliberately minimal, and it's measurable:

• Fully manual — nothing is put to sleep unless you say so
• Pinned tabs, tabs playing audio, and your active tab are never touched
• No background process at all — when the popup is closed, the extension isn't running. Zero idle memory, zero idle CPU.
• Under 15 KB installed — vanilla JavaScript, zero dependencies, no frameworks
• No data collection of any kind — the extension never leaves your browser

Uses Chrome's native tab discarding, the same mechanism Chrome itself uses under memory pressure. The extension itself uses less memory than one of the tabs it puts to sleep.

## Category
Productivity → Tools

## Language
English

## Privacy tab answers
- **Single purpose description:** Lets the user manually put browser tabs to sleep (discard them) to free up memory, and reload them on demand.
- **Permission justification — `tabs`:** Required to list the tabs in the current window (title, URL, favicon shown in the popup), to discard tabs the user chooses to put to sleep, and to reload or focus tabs the user clicks. Tab data is only displayed in the popup; it is never stored or transmitted.
- **Permission justification — `tabGroups`:** Required to read tab group names and colors so the popup can show tabs organized by group and let the user put a whole group to sleep. Group data is only displayed in the popup; it is never stored or transmitted.
- **Remote code:** No
- **Data usage:** Does not collect or transmit any user data.

## Promotional video
Paste into the "Promotional video" field on the Store listing tab (YouTube URL only — no file upload):
https://youtu.be/d1diArNYcq0

## Assets
- Store icon 128×128: `../icons/icon128.png`
- Screenshot 1280×800: `screenshot-1280x800.png`
- Upload package: `tab-suspender-v1.1.0.zip`

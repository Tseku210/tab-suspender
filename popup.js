const INTERNAL_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "brave://",
];

const ERROR_DISPLAY_MS = 4000;
const RENDER_DEBOUNCE_MS = 50;

function isInternalUrl(url) {
  return !url || INTERNAL_URL_PREFIXES.some((p) => url.startsWith(p));
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getFaviconUrl(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
    return tab.favIconUrl;
  }
  return "";
}

function getTabBadges(tab) {
  const badges = [];
  if (tab.active) badges.push({ label: "Active", class: "badge-active" });
  if (tab.discarded) badges.push({ label: "Asleep", class: "badge-asleep" });
  if (tab.pinned) badges.push({ label: "Pinned", class: "badge-pinned" });
  if (tab.audible) badges.push({ label: "Playing", class: "badge-audible" });
  return badges;
}

function canSleep(tab) {
  if (tab.active || tab.pinned || tab.audible || tab.discarded) return false;
  if (isInternalUrl(tab.url)) return false;
  return true;
}

// --- Error banner ---

let errorTimer = null;

function showError(message) {
  const banner = document.getElementById("error-banner");
  banner.textContent = message;
  banner.classList.add("is-visible");
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => {
    banner.classList.remove("is-visible");
    errorTimer = null;
  }, ERROR_DISPLAY_MS);
}

// --- Row construction ---

function createFaviconFallback(tab) {
  const tile = document.createElement("span");
  tile.className = "tab-favicon tab-favicon-fallback";
  const hostname = getHostname(tab.url || "");
  tile.textContent = hostname ? hostname[0].toUpperCase() : "?";
  return tile;
}

function createFavicon(tab) {
  const src = getFaviconUrl(tab);
  if (!src) return createFaviconFallback(tab);
  const favicon = document.createElement("img");
  favicon.className = "tab-favicon";
  favicon.alt = "";
  // Attach onerror BEFORE setting src so cached failures are still handled.
  favicon.onerror = () => favicon.replaceWith(createFaviconFallback(tab));
  favicon.src = src;
  return favicon;
}

function createActionButton(tab) {
  if (tab.discarded) {
    const btn = document.createElement("button");
    btn.className = "tab-action";
    btn.type = "button";
    btn.textContent = "Wake";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await chrome.tabs.reload(tab.id);
      } catch (err) {
        showError(`Could not wake tab: ${err.message}`);
      }
    });
    return btn;
  }
  if (canSleep(tab)) {
    const btn = document.createElement("button");
    btn.className = "tab-action";
    btn.type = "button";
    btn.textContent = "Sleep";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await chrome.tabs.discard(tab.id);
      } catch (err) {
        showError(`Could not put tab to sleep: ${err.message}`);
      }
    });
    return btn;
  }
  return null;
}

function createTabRow(tab) {
  const item = document.createElement("div");
  item.className = "tab-item";
  if (tab.active) item.classList.add("is-active");
  if (tab.discarded) item.classList.add("is-asleep");

  const main = document.createElement("button");
  main.className = "tab-item-main";
  main.type = "button";
  main.addEventListener("click", async () => {
    try {
      await chrome.tabs.update(tab.id, { active: true });
      window.close();
    } catch (err) {
      showError(`Could not switch tab: ${err.message}`);
    }
  });

  main.appendChild(createFavicon(tab));

  const info = document.createElement("div");
  info.className = "tab-info";

  const title = document.createElement("div");
  title.className = "tab-title";
  title.textContent = tab.title || "Untitled";
  title.title = tab.title || "";

  const url = document.createElement("div");
  url.className = "tab-url";
  url.textContent = getHostname(tab.url || "");

  info.appendChild(title);
  info.appendChild(url);
  main.appendChild(info);

  const badges = getTabBadges(tab);
  if (badges.length) {
    const container = document.createElement("div");
    container.className = "tab-badges";
    for (const status of badges) {
      const badge = document.createElement("span");
      badge.className = `tab-badge ${status.class}`;
      badge.textContent = status.label;
      container.appendChild(badge);
    }
    main.appendChild(container);
  }

  item.appendChild(main);

  if (!tab.active && !isInternalUrl(tab.url)) {
    const action = createActionButton(tab);
    if (action) item.appendChild(action);
  }

  return item;
}

// --- Rendering ---

async function renderTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const list = document.getElementById("tab-list");
  const stats = document.getElementById("stats");

  const asleep = tabs.filter((t) => t.discarded).length;
  stats.textContent = `${tabs.length} tabs · ${asleep} asleep`;

  const fragment = document.createDocumentFragment();
  for (const tab of tabs) {
    fragment.appendChild(createTabRow(tab));
  }
  list.replaceChildren(fragment);
}

function safeRender() {
  renderTabs().catch((err) => {
    showError(`Failed to load tabs: ${err.message}`);
  });
}

// --- Event-driven updates (trailing debounce) ---

let renderHandle = null;
function scheduleRender() {
  if (renderHandle !== null) clearTimeout(renderHandle);
  renderHandle = setTimeout(() => {
    renderHandle = null;
    safeRender();
  }, RENDER_DEBOUNCE_MS);
}

chrome.tabs.onCreated.addListener(scheduleRender);
chrome.tabs.onRemoved.addListener(scheduleRender);
chrome.tabs.onUpdated.addListener(scheduleRender);
chrome.tabs.onActivated.addListener(scheduleRender);
chrome.tabs.onMoved.addListener(scheduleRender);
chrome.tabs.onReplaced.addListener(scheduleRender);

// --- Bulk actions ---

document.getElementById("sleep-others").addEventListener("click", async () => {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const targets = tabs.filter(canSleep);
    await Promise.all(
      targets.map((t) =>
        chrome.tabs.discard(t.id).catch((err) => {
          showError(`Could not put "${t.title}" to sleep: ${err.message}`);
        })
      )
    );
  } catch (err) {
    showError(`Could not put tabs to sleep: ${err.message}`);
  }
});

document.getElementById("wake-all").addEventListener("click", async () => {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const targets = tabs.filter((t) => t.discarded);
    await Promise.all(
      targets.map((t) =>
        chrome.tabs.reload(t.id).catch((err) => {
          showError(`Could not wake "${t.title}": ${err.message}`);
        })
      )
    );
  } catch (err) {
    showError(`Could not wake tabs: ${err.message}`);
  }
});

safeRender();

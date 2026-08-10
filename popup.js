const INTERNAL_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "brave://",
];

const ERROR_DISPLAY_MS = 4000;
const RENDER_DEBOUNCE_MS = 50;
// No per-tab memory API exists on stable Chrome, so the freed figure is a
// flat estimate. Always displayed with "~".
const EST_MB_PER_TAB = 120;
const TAB_GROUP_ID_NONE = -1;

const GROUP_COLORS = {
  grey: "#7a7a7a",
  blue: "#5a8ae0",
  red: "#e06a6a",
  yellow: "#d6b34a",
  green: "#5aad7a",
  pink: "#e07aad",
  purple: "#ad7ae0",
  cyan: "#5ab3c4",
  orange: "#e09a5a",
};

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

function formatEstimate(mb) {
  if (mb >= 1000) {
    return `${(mb / 1000).toFixed(1).replace(/\.0$/, "")} GB`;
  }
  return `${mb} MB`;
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

// --- Theme ---

const THEME_KEY = "theme";

function currentTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function applyTheme(theme) {
  document.body.classList.toggle("light", theme === "light");
  // Icon shows what clicking switches to.
  document.getElementById("theme-toggle").textContent =
    theme === "light" ? "☾" : "☀";
}

applyTheme(currentTheme());

document.getElementById("theme-toggle").addEventListener("click", () => {
  const next = currentTheme() === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

// --- Sleep / wake ---

async function sleepTabs(targets) {
  await Promise.all(
    targets.map((t) =>
      chrome.tabs.discard(t.id).catch((err) => {
        showError(`Could not put "${t.title}" to sleep: ${err.message}`);
      })
    )
  );
}

async function wakeTabs(targets) {
  await Promise.all(
    targets.map((t) =>
      chrome.tabs.reload(t.id).catch((err) => {
        showError(`Could not wake "${t.title}": ${err.message}`);
      })
    )
  );
}

// --- Select mode ---

let selectMode = false;
const selected = new Set();

function updateSelectCount() {
  const btn = document.getElementById("sleep-selected");
  btn.textContent = `Sleep (${selected.size})`;
  btn.disabled = selected.size === 0;
}

function setSelectMode(on) {
  selectMode = on;
  selected.clear();
  document.body.classList.toggle("is-selecting", on);
  updateSelectCount();
  safeRender();
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
  if (!tab.discarded && !canSleep(tab)) return null;
  const btn = document.createElement("button");
  btn.className = "tab-action";
  btn.type = "button";
  btn.textContent = tab.discarded ? "Wake" : "Sleep";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (tab.discarded) wakeTabs([tab]);
    else sleepTabs([tab]);
  });
  return btn;
}

function createGroupHeader(group, groupTabs) {
  const sleepable = groupTabs.filter(canSleep);
  // In select mode the whole header is a toggle for the group's sleepable set.
  const clickable = selectMode && sleepable.length > 0;
  const header = document.createElement(clickable ? "button" : "div");
  header.className = "group-header";
  if (clickable) {
    header.type = "button";
    header.addEventListener("click", () => {
      const allSelected = sleepable.every((t) => selected.has(t.id));
      for (const t of sleepable) {
        if (allSelected) selected.delete(t.id);
        else selected.add(t.id);
      }
      updateSelectCount();
      safeRender();
    });
  }

  const dot = document.createElement("span");
  dot.className = "group-dot";
  dot.style.background = GROUP_COLORS[group?.color] || GROUP_COLORS.grey;
  header.appendChild(dot);

  const name = document.createElement("span");
  name.className = "group-name";
  name.textContent = group?.title || "Untitled";
  header.appendChild(name);

  if (!selectMode) {
    const asleep = groupTabs.filter((t) => t.discarded);
    const action = sleepable.length
      ? { label: "Sleep", run: () => sleepTabs(sleepable) }
      : asleep.length
        ? { label: "Wake", run: () => wakeTabs(asleep) }
        : null;
    if (action) {
      const btn = document.createElement("button");
      btn.className = "tab-action";
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", action.run);
      header.appendChild(btn);
    }
  }

  return header;
}

function createTabRow(tab) {
  const item = document.createElement("div");
  item.className = "tab-item";
  if (tab.active) item.classList.add("is-active");
  if (tab.discarded) item.classList.add("is-asleep");
  if (selectMode) {
    if (canSleep(tab)) {
      item.classList.add("is-selectable");
      if (selected.has(tab.id)) item.classList.add("is-selected");
    } else {
      item.classList.add("is-excluded");
    }
  }

  const main = document.createElement("button");
  main.className = "tab-item-main";
  main.type = "button";
  main.addEventListener("click", async () => {
    if (selectMode) {
      if (!canSleep(tab)) return;
      if (selected.has(tab.id)) selected.delete(tab.id);
      else selected.add(tab.id);
      item.classList.toggle("is-selected", selected.has(tab.id));
      updateSelectCount();
      return;
    }
    try {
      await chrome.tabs.update(tab.id, { active: true });
      window.close();
    } catch (err) {
      showError(`Could not switch tab: ${err.message}`);
    }
  });

  if (selectMode && canSleep(tab)) {
    const checkbox = document.createElement("span");
    checkbox.className = "tab-checkbox";
    main.appendChild(checkbox);
  }

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

  if (!selectMode && !tab.active && !isInternalUrl(tab.url)) {
    const action = createActionButton(tab);
    if (action) item.appendChild(action);
  }

  return item;
}

// --- Rendering ---

async function renderTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  // Group IDs are globally unique, so query all groups and match by id —
  // avoids WINDOW_ID_CURRENT resolution quirks in the popup context.
  let groups = [];
  if (chrome.tabGroups) {
    try {
      groups = await chrome.tabGroups.query({});
    } catch {
      // Tab groups unavailable; render headers without names.
    }
  }
  const list = document.getElementById("tab-list");
  const stats = document.getElementById("stats");

  // Drop selections for tabs that closed or became unsleepable.
  const sleepableIds = new Set(tabs.filter(canSleep).map((t) => t.id));
  for (const id of [...selected]) {
    if (!sleepableIds.has(id)) selected.delete(id);
  }
  updateSelectCount();

  const sleepable = sleepableIds.size;
  const asleep = tabs.filter((t) => t.discarded).length;
  const tabWord = tabs.length === 1 ? "tab" : "tabs";
  stats.textContent =
    asleep > 0
      ? `${tabs.length} ${tabWord}, ~${formatEstimate(asleep * EST_MB_PER_TAB)} freed`
      : `${tabs.length} ${tabWord}`;

  const sleepOthersBtn = document.getElementById("sleep-others");
  sleepOthersBtn.textContent = `Sleep Others (${sleepable})`;
  sleepOthersBtn.disabled = sleepable === 0;

  const wakeAllBtn = document.getElementById("wake-all");
  wakeAllBtn.textContent = `Wake All (${asleep})`;
  wakeAllBtn.disabled = asleep === 0;

  document.getElementById("select-toggle").disabled = sleepable === 0;

  const grouped = new Map();
  const ungrouped = [];
  for (const tab of tabs) {
    const gid = tab.groupId ?? TAB_GROUP_ID_NONE;
    if (gid === TAB_GROUP_ID_NONE) {
      ungrouped.push(tab);
    } else {
      if (!grouped.has(gid)) grouped.set(gid, []);
      grouped.get(gid).push(tab);
    }
  }

  const fragment = document.createDocumentFragment();
  for (const [groupId, groupTabs] of grouped) {
    const group = groups.find((g) => g.id === groupId);
    fragment.appendChild(createGroupHeader(group, groupTabs));
    for (const tab of groupTabs) {
      fragment.appendChild(createTabRow(tab));
    }
  }
  if (grouped.size && ungrouped.length) {
    const divider = document.createElement("div");
    divider.className = "section-divider";
    fragment.appendChild(divider);
  }
  for (const tab of ungrouped) {
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

if (chrome.tabGroups) {
  chrome.tabGroups.onCreated.addListener(scheduleRender);
  chrome.tabGroups.onUpdated.addListener(scheduleRender);
  chrome.tabGroups.onMoved.addListener(scheduleRender);
  chrome.tabGroups.onRemoved.addListener(scheduleRender);
}

// --- Bulk actions ---

document.getElementById("sleep-others").addEventListener("click", async () => {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    await sleepTabs(tabs.filter(canSleep));
  } catch (err) {
    showError(`Could not put tabs to sleep: ${err.message}`);
  }
});

document.getElementById("wake-all").addEventListener("click", async () => {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    await wakeTabs(tabs.filter((t) => t.discarded));
  } catch (err) {
    showError(`Could not wake tabs: ${err.message}`);
  }
});

document.getElementById("select-toggle").addEventListener("click", () => {
  setSelectMode(true);
});

document.getElementById("select-cancel").addEventListener("click", () => {
  setSelectMode(false);
});

document.getElementById("sleep-selected").addEventListener("click", async () => {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    await sleepTabs(tabs.filter((t) => selected.has(t.id) && canSleep(t)));
  } catch (err) {
    showError(`Could not put tabs to sleep: ${err.message}`);
  }
  setSelectMode(false);
});

safeRender();

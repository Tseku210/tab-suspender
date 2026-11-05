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

// A split view shows two tabs at once but only one is `active`; treat the
// other half as on screen too so bulk sleep never blanks a visible pane.
async function queryTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const shownSplit = tabs.find((t) => t.active)?.splitViewId;
  for (const t of tabs) {
    t.visible = t.active || (shownSplit > -1 && t.splitViewId === shownSplit);
  }
  return tabs;
}

function formatAge(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

function getTabBadges(tab) {
  const badges = [];
  if (tab.visible) badges.push("Active");
  if (tab.pinned) badges.push("Pinned");
  if (tab.audible) badges.push("Playing");
  return badges;
}

function canSleep(tab) {
  if (tab.visible || tab.pinned || tab.audible || tab.discarded) return false;
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
  document.documentElement.style.colorScheme = theme;
  // Icon shows what clicking switches to.
  const toggle = document.getElementById("theme-toggle");
  const next = theme === "light" ? "dark" : "light";
  toggle.textContent = theme === "light" ? "☾" : "☀";
  toggle.title = toggle.ariaLabel = `Switch to ${next} theme`;
}

applyTheme(currentTheme());

document.getElementById("theme-toggle").addEventListener("click", () => {
  const next = currentTheme() === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

// --- Sleep / wake ---

// One banner for the whole batch, so a bulk failure isn't reduced to
// whichever tab happened to fail last.
async function runOnTabs(targets, run, phrase) {
  const results = await Promise.allSettled(targets.map((t) => run(t.id)));
  const failed = targets.filter((_, i) => results[i].status === "rejected");
  if (!failed.length) return;
  const reason = results.find((r) => r.reason).reason.message;
  const what =
    failed.length === 1 ? `"${failed[0].title}"` : `${failed.length} tabs`;
  showError(`Could not ${phrase(what)}: ${reason}`);
}

const sleepTabs = (targets) =>
  runOnTabs(targets, (id) => chrome.tabs.discard(id), (w) => `put ${w} to sleep`);

const wakeTabs = (targets) =>
  runOnTabs(targets, (id) => chrome.tabs.reload(id), (w) => `wake ${w}`);

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

function el(tag, className, text, parent) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  if (tag === "button") node.type = "button";
  parent?.appendChild(node);
  return node;
}

function actionButton(label, run, parent) {
  el("button", "tab-action", label, parent).addEventListener("click", (e) => {
    e.stopPropagation();
    run();
  });
}

function createFaviconFallback(tab) {
  const hostname = getHostname(tab.url || "");
  return el(
    "span",
    "tab-favicon tab-favicon-fallback",
    hostname ? hostname[0].toUpperCase() : "?"
  );
}

function createFavicon(tab) {
  const src = getFaviconUrl(tab);
  if (!src) return createFaviconFallback(tab);
  const favicon = el("img", "tab-favicon");
  favicon.alt = "";
  // Attach onerror BEFORE setting src so cached failures are still handled.
  favicon.onerror = () => favicon.replaceWith(createFaviconFallback(tab));
  favicon.src = src;
  return favicon;
}

function createGroupHeader(group, groupTabs) {
  const sleepable = groupTabs.filter(canSleep);
  // In select mode the whole header is a toggle for the group's sleepable set.
  const clickable = selectMode && sleepable.length > 0;
  const header = el(clickable ? "button" : "div", "group-header");
  if (clickable) {
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

  el("span", "group-dot", "", header).style.background =
    GROUP_COLORS[group?.color] || GROUP_COLORS.grey;
  el("span", "group-name", group?.title || "Untitled", header);

  if (!selectMode) {
    const asleep = groupTabs.filter((t) => t.discarded);
    if (sleepable.length) actionButton("Sleep", () => sleepTabs(sleepable), header);
    else if (asleep.length) actionButton("Wake", () => wakeTabs(asleep), header);
  }

  return header;
}

function createTabRow(tab) {
  const item = el("div", "tab-item");
  const selectable = selectMode && canSleep(tab);
  item.classList.toggle("is-active", tab.visible);
  item.classList.toggle("is-asleep", !!tab.discarded);
  item.classList.toggle("is-selected", selectable && selected.has(tab.id));
  item.classList.toggle("is-excluded", selectMode && !selectable);

  const main = el("button", "tab-item-main", "", item);
  main.dataset.id = tab.id;
  if (selectable) main.ariaPressed = selected.has(tab.id);
  main.addEventListener("click", async () => {
    if (selectMode) {
      if (!selectable) return;
      if (selected.has(tab.id)) selected.delete(tab.id);
      else selected.add(tab.id);
      item.classList.toggle("is-selected", selected.has(tab.id));
      main.ariaPressed = selected.has(tab.id);
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

  if (selectable) el("span", "tab-checkbox", "", main).ariaHidden = true;
  const icon = el("span", "tab-icon", "", main);
  icon.appendChild(createFavicon(tab));
  if (tab.discarded) {
    icon.role = "img";
    icon.title = icon.ariaLabel = "Asleep";
  }

  const info = el("div", "tab-info", "", main);
  el("div", "tab-title", tab.title || "Untitled", info).title = tab.title || "";
  const url = el("div", "tab-url", getHostname(tab.url || ""), info);
  if (!tab.visible && tab.lastAccessed) {
    el("span", "tab-age", formatAge(tab.lastAccessed), url).title = "Last used";
  }

  const badges = getTabBadges(tab);
  if (badges.length) {
    const container = el("div", "tab-badges", "", main);
    for (const b of badges) {
      el("span", `tab-badge badge-${b.toLowerCase()}`, b, container);
    }
  }

  const canAct = tab.discarded || canSleep(tab);
  if (!selectMode && !tab.visible && !isInternalUrl(tab.url) && canAct) {
    actionButton(
      tab.discarded ? "Wake" : "Sleep",
      () => (tab.discarded ? wakeTabs([tab]) : sleepTabs([tab])),
      item
    );
  }

  return item;
}

// --- Rendering ---

const filterInput = document.getElementById("filter");

function matchesFilter(tab) {
  const q = filterInput.value.trim().toLowerCase();
  return !q || `${tab.title || ""} ${getHostname(tab.url || "")}`.toLowerCase().includes(q);
}

async function renderTabs() {
  const tabs = await queryTabs();
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
  for (const tab of tabs.filter(matchesFilter)) {
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
    el("div", "section-divider", "", fragment);
  }
  for (const tab of ungrouped) {
    fragment.appendChild(createTabRow(tab));
  }
  // Re-renders fire on any tab event; keep keyboard focus on the same row.
  const focusedId = document.activeElement?.dataset.id;
  list.replaceChildren(fragment);
  if (focusedId) list.querySelector(`[data-id="${focusedId}"]`)?.focus();
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

for (const api of [chrome.tabs, chrome.tabGroups]) {
  for (const event of [
    "onCreated", "onRemoved", "onUpdated", "onActivated", "onMoved", "onReplaced",
  ]) {
    api?.[event]?.addListener(scheduleRender);
  }
}

// --- Filter and keyboard navigation ---

filterInput.addEventListener("input", safeRender);

document.addEventListener("keydown", (e) => {
  const rows = [...document.querySelectorAll(".tab-item-main")];
  if (e.target === filterInput && e.key === "Enter") {
    rows[0]?.click();
    return;
  }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const i = rows.indexOf(document.activeElement);
  const next = i + (e.key === "ArrowDown" ? 1 : -1);
  if (next < 0) filterInput.focus();
  else rows[Math.min(next, rows.length - 1)]?.focus();
});

// --- Bulk actions ---

function onBulk(id, run, pick) {
  document.getElementById(id).addEventListener("click", async () => {
    try {
      await run((await queryTabs()).filter(pick));
    } catch (err) {
      showError(`Could not load tabs: ${err.message}`);
    }
    if (selectMode) setSelectMode(false);
  });
}

onBulk("sleep-others", sleepTabs, canSleep);
onBulk("wake-all", wakeTabs, (t) => t.discarded);
onBulk("sleep-selected", sleepTabs, (t) => selected.has(t.id) && canSleep(t));

document.getElementById("select-toggle").addEventListener("click", () => {
  setSelectMode(true);
});

document.getElementById("select-cancel").addEventListener("click", () => {
  setSelectMode(false);
});

safeRender();

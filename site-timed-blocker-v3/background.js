const COOLDOWN_MS = 60 * 60 * 1000;
const STORAGE_KEY = "siteStates";
const RULE_BASE_ID = 1000;
const ICON_SIZE = 32;
let iconInterval = null;

function nowMs() {
  return Date.now();
}

function normalizeHost(input) {
  if (!input) return "";
  let value = String(input).trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0];
  value = value.split(":")[0];
  return value;
}

function getHostFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return normalizeHost(parsed.hostname);
  } catch {
    return "";
  }
}

function isManagedHostUrl(url, host) {
  const current = getHostFromUrl(url);
  return !!current && current === normalizeHost(host);
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function getAllSiteStates() {
  const data = await browser.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

async function saveAllSiteStates(siteStates) {
  await browser.storage.local.set({ [STORAGE_KEY]: siteStates });
}

function defaultSiteState(host) {
  return {
    host,
    mode: "blocked",
    unblockUntil: 0,
    cooldownUntil: 0,
    addedAt: nowMs()
  };
}

function ensureSiteShape(host, raw) {
  return {
    host,
    mode: raw?.mode || "blocked",
    unblockUntil: Number(raw?.unblockUntil || 0),
    cooldownUntil: Number(raw?.cooldownUntil || 0),
    addedAt: Number(raw?.addedAt || nowMs())
  };
}

async function getSiteState(host) {
  host = normalizeHost(host);
  const all = await getAllSiteStates();
  return ensureSiteShape(host, all[host] || defaultSiteState(host));
}

async function setSiteState(host, state) {
  host = normalizeHost(host);
  const all = await getAllSiteStates();
  all[host] = ensureSiteShape(host, state);
  await saveAllSiteStates(all);
}

async function removeSiteState(host) {
  host = normalizeHost(host);
  const all = await getAllSiteStates();
  delete all[host];
  await saveAllSiteStates(all);
}

async function listHosts() {
  const all = await getAllSiteStates();
  return Object.keys(all).sort();
}

function hostToRuleId(host) {
  let hash = 0;
  for (let i = 0; i < host.length; i++) {
    hash = ((hash << 5) - hash) + host.charCodeAt(i);
    hash |= 0;
  }
  return RULE_BASE_ID + Math.abs(hash % 900000);
}

function buildBlockRule(host) {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    id: hostToRuleId(host),
    priority: 1,
    action: { type: "block" },
    condition: {
      regexFilter: `^https?://([^.]+\\.)*${escaped}(/.*)?$`,
      resourceTypes: ["main_frame", "sub_frame"]
    }
  };
}

function alarmNamesForHost(host) {
  return {
    unblock: `unblock-expire:${host}`,
    cooldown: `cooldown-expire:${host}`
  };
}

async function normalizeSiteState(host) {
  const site = await getSiteState(host);
  const now = nowMs();
  let changed = false;

  if (site.mode === "unblocked" && now >= site.unblockUntil) {
    site.mode = "cooldown";
    site.unblockUntil = 0;
    site.cooldownUntil = now + COOLDOWN_MS;
    changed = true;
  }

  if (site.mode === "cooldown" && now >= site.cooldownUntil) {
    site.mode = "blocked";
    site.cooldownUntil = 0;
    changed = true;
  }

  if (changed) {
    await setSiteState(host, site);
  }

  return site;
}

async function clearHostAlarms(host) {
  const names = alarmNamesForHost(host);
  await browser.alarms.clear(names.unblock);
  await browser.alarms.clear(names.cooldown);
}

async function scheduleHostAlarms(host, state) {
  await clearHostAlarms(host);
  const names = alarmNamesForHost(host);
  const now = nowMs();

  if (state.mode === "unblocked" && state.unblockUntil > now) {
    browser.alarms.create(names.unblock, { when: state.unblockUntil });
  }
  if (state.mode === "cooldown" && state.cooldownUntil > now) {
    browser.alarms.create(names.cooldown, { when: state.cooldownUntil });
  }
}

async function blankManagedHostTabs(host) {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && isManagedHostUrl(tab.url, host)) {
      try {
        await browser.tabs.update(tab.id, { url: "about:blank" });
      } catch {
      }
    }
  }
}

async function rebuildDynamicRules() {
  const hosts = await listHosts();
  const existingRules = await browser.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map(rule => rule.id);
  const addRules = [];

  for (const host of hosts) {
    const state = await normalizeSiteState(host);
    await scheduleHostAlarms(host, state);
    if (state.mode !== "unblocked") {
      addRules.push(buildBlockRule(host));
      await blankManagedHostTabs(host);
    }
  }

  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });

  await updateToolbarForActiveTab();
  manageIconInterval();
}

async function addHost(host) {
  host = normalizeHost(host);
  if (!host) throw new Error("No valid host to add.");
  const existing = await getSiteState(host);
  if (!existing.addedAt) {
    existing.addedAt = nowMs();
  }
  await setSiteState(host, existing);
  await rebuildDynamicRules();
  return await getSiteStatus(host);
}

async function removeHost(host) {
  host = normalizeHost(host);
  await clearHostAlarms(host);
  await removeSiteState(host);
  await rebuildDynamicRules();
}

async function unblockHostForMinutes(host, minutes) {
  host = normalizeHost(host);
  const current = await normalizeSiteState(host);
  if (current.mode === "cooldown") {
    throw new Error("Unblock is disabled during cooldown.");
  }
  const next = {
    ...current,
    mode: "unblocked",
    unblockUntil: nowMs() + (minutes * 60 * 1000),
    cooldownUntil: 0
  };
  await setSiteState(host, next);
  await rebuildDynamicRules();
  return await getSiteStatus(host);
}

async function blockHostNow(host) {
  host = normalizeHost(host);
  const current = await getSiteState(host);
  const next = {
    ...current,
    mode: "cooldown",
    unblockUntil: 0,
    cooldownUntil: nowMs() + COOLDOWN_MS
  };
  await setSiteState(host, next);
  await rebuildDynamicRules();
  return await getSiteStatus(host);
}

async function getSiteStatus(host) {
  host = normalizeHost(host);
  const site = await normalizeSiteState(host);
  return {
    host,
    mode: site.mode,
    unblockUntil: site.unblockUntil,
    cooldownUntil: site.cooldownUntil,
    exists: (await listHosts()).includes(host)
  };
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getActiveHost() {
  const tab = await getActiveTab();
  return getHostFromUrl(tab?.url || "");
}

function setIconTextIcon(text, bgColor = "#c62828", fgColor = "#ffffff") {
  const canvas = new OffscreenCanvas(ICON_SIZE, ICON_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
  ctx.fillStyle = fgColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const len = String(text).length;
  let size = 16;
  if (len >= 4) size = 11;
  if (len >= 5) size = 9;
  if (len >= 7) size = 7;
  ctx.font = `${size}px sans-serif`;
  ctx.fillText(String(text), ICON_SIZE / 2, ICON_SIZE / 2 + 0.5);

  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
}

async function updateToolbarForActiveTab() {
  const activeHost = await getActiveHost();
  const hosts = await listHosts();
  let host = activeHost && hosts.includes(activeHost) ? activeHost : "";

  if (!host) {
    const unblockedHosts = [];
    for (const item of hosts) {
      const state = await normalizeSiteState(item);
      if (state.mode === "unblocked") unblockedHosts.push(item);
    }
    host = unblockedHosts[0] || hosts[0] || "";
  }

  if (!host) {
    await browser.action.setIcon({ imageData: setIconTextIcon("+") });
    await browser.action.setTitle({ title: "Timed Site Blocker" });
    return;
  }

  const state = await normalizeSiteState(host);
  const now = nowMs();

  if (state.mode === "unblocked") {
    const remaining = Math.max(0, state.unblockUntil - now);
    await browser.action.setIcon({ imageData: setIconTextIcon(formatRemaining(remaining), "#1f7a1f") });
    await browser.action.setTitle({ title: `${host} allowed for ${formatRemaining(remaining)} more` });
    return;
  }

  if (state.mode === "cooldown") {
    const remaining = Math.max(0, state.cooldownUntil - now);
    await browser.action.setIcon({ imageData: setIconTextIcon("LOCK", "#5b2c83") });
    await browser.action.setTitle({ title: `${host} blocked. Unblock locked for ${formatRemaining(remaining)}.` });
    return;
  }

  await browser.action.setIcon({ imageData: setIconTextIcon("ON", "#c62828") });
  await browser.action.setTitle({ title: `${host} is blocked` });
}

function manageIconInterval() {
  if (iconInterval) {
    clearInterval(iconInterval);
    iconInterval = null;
  }
  iconInterval = setInterval(async () => {
    await rebuildExpiredStatesOnly();
    await updateToolbarForActiveTab();
  }, 1000);
}

async function rebuildExpiredStatesOnly() {
  const hosts = await listHosts();
  let changed = false;
  for (const host of hosts) {
    const before = await getSiteState(host);
    const after = await normalizeSiteState(host);
    if (before.mode !== after.mode || before.unblockUntil !== after.unblockUntil || before.cooldownUntil !== after.cooldownUntil) {
      changed = true;
      if (after.mode !== "unblocked") {
        await blankManagedHostTabs(host);
      }
    }
  }
  if (changed) {
    const existingRules = await browser.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules.map(rule => rule.id);
    const addRules = [];
    for (const host of hosts) {
      const state = await getSiteState(host);
      await scheduleHostAlarms(host, state);
      if (state.mode !== "unblocked") addRules.push(buildBlockRule(host));
    }
    await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  }
}

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm?.name) return;
  const parts = alarm.name.split(":");
  if (parts.length !== 2) return;
  await rebuildDynamicRules();
});

browser.tabs.onActivated.addListener(async () => {
  await updateToolbarForActiveTab();
});

browser.tabs.onUpdated.addListener(async (_tabId, _changeInfo, _tab) => {
  await updateToolbarForActiveTab();
});

browser.runtime.onInstalled.addListener(async () => {
  await rebuildDynamicRules();
});

browser.runtime.onStartup.addListener(async () => {
  await rebuildDynamicRules();
});

browser.runtime.onMessage.addListener(async (msg) => {
  if (!msg?.type) return null;

  if (msg.type === "GET_POPUP_STATE") {
    const hosts = await listHosts();
    const activeHost = await getActiveHost();
    const activeSiteManaged = activeHost && hosts.includes(activeHost);
    const selectedHost = normalizeHost(msg.selectedHost || (activeSiteManaged ? activeHost : hosts[0] || ""));
    const selectedStatus = selectedHost ? await getSiteStatus(selectedHost) : null;
    return {
      activeHost,
      hosts,
      selectedHost,
      selectedStatus
    };
  }

  if (msg.type === "ADD_CURRENT_TAB") {
    const activeHost = await getActiveHost();
    if (!activeHost) throw new Error("Current tab is not a normal website.");
    await addHost(activeHost);
    return await browser.runtime.sendMessage({ type: "GET_POPUP_STATE", selectedHost: activeHost });
  }

  if (msg.type === "ADD_HOST") {
    const host = normalizeHost(msg.host);
    await addHost(host);
    return await browser.runtime.sendMessage({ type: "GET_POPUP_STATE", selectedHost: host });
  }

  if (msg.type === "REMOVE_HOST") {
    await removeHost(msg.host);
    return await browser.runtime.sendMessage({ type: "GET_POPUP_STATE" });
  }

  if (msg.type === "UNBLOCK_HOST") {
    await unblockHostForMinutes(msg.host, Number(msg.minutes));
    return await browser.runtime.sendMessage({ type: "GET_POPUP_STATE", selectedHost: msg.host });
  }

  if (msg.type === "BLOCK_HOST_NOW") {
    await blockHostNow(msg.host);
    return await browser.runtime.sendMessage({ type: "GET_POPUP_STATE", selectedHost: msg.host });
  }

  if (msg.type === "REFRESH_TOOLBAR") {
    await updateToolbarForActiveTab();
    return { ok: true };
  }

  return null;
});

const STORAGE_KEY = "mutedHosts";

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
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return normalizeHost(parsed.hostname);
  } catch {
    return "";
  }
}

function hostMatches(savedHost, currentHost) {
  return currentHost === savedHost || currentHost.endsWith(`.${savedHost}`);
}

async function getMutedHosts() {
  const data = await browser.storage.local.get(STORAGE_KEY);
  const hosts = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  return [...new Set(hosts.map(normalizeHost).filter(Boolean))].sort();
}

async function setMutedHosts(hosts) {
  const cleaned = [...new Set(hosts.map(normalizeHost).filter(Boolean))].sort();
  await browser.storage.local.set({ [STORAGE_KEY]: cleaned });
  await updateBadgeForActiveTab();
}

async function addMutedHost(host) {
  const cleaned = normalizeHost(host);
  if (!cleaned) throw new Error("Invalid host.");
  const hosts = await getMutedHosts();
  if (!hosts.includes(cleaned)) hosts.push(cleaned);
  await setMutedHosts(hosts);
  await muteMatchingOpenTabs(cleaned);
  return cleaned;
}

async function removeMutedHost(host) {
  const cleaned = normalizeHost(host);
  const hosts = await getMutedHosts();
  await setMutedHosts(hosts.filter(h => h !== cleaned));
}

async function shouldMuteUrl(url) {
  const host = getHostFromUrl(url);
  if (!host) return false;
  const hosts = await getMutedHosts();
  return hosts.some(savedHost => hostMatches(savedHost, host));
}

async function muteTabIfNeeded(tabId, url) {
  if (!tabId || !url) return;
  if (await shouldMuteUrl(url)) {
    try {
      await browser.tabs.update(tabId, { muted: true });
    } catch {}
  }
}

async function muteMatchingOpenTabs(newHost = "") {
  const tabs = await browser.tabs.query({});
  const hosts = newHost ? [normalizeHost(newHost)] : await getMutedHosts();
  if (!hosts.length) return;

  for (const tab of tabs) {
    const tabHost = getHostFromUrl(tab.url || "");
    if (!tabHost) continue;
    if (hosts.some(savedHost => hostMatches(savedHost, tabHost))) {
      try {
        await browser.tabs.update(tab.id, { muted: true });
      } catch {}
    }
  }
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function updateBadgeForActiveTab() {
  const activeTab = await getActiveTab();
  const host = getHostFromUrl(activeTab?.url || "");
  const hosts = await getMutedHosts();
  const matches = host && hosts.some(savedHost => hostMatches(savedHost, host));

  await browser.action.setBadgeText({ text: matches ? "M" : "" });
  if (matches) {
    await browser.action.setBadgeBackgroundColor({ color: "#7b1fa2" });
    await browser.action.setTitle({ title: `Auto mute enabled for ${host}` });
  } else {
    await browser.action.setTitle({ title: "Site Auto Muter" });
  }
}

browser.runtime.onInstalled.addListener(async () => {
  await muteMatchingOpenTabs();
  await updateBadgeForActiveTab();
});

browser.runtime.onStartup.addListener(async () => {
  await muteMatchingOpenTabs();
  await updateBadgeForActiveTab();
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    await muteTabIfNeeded(tabId, changeInfo.url);
  } else if (changeInfo.status === "complete" && tab?.url) {
    await muteTabIfNeeded(tabId, tab.url);
  }
  await updateBadgeForActiveTab();
});

browser.tabs.onActivated.addListener(async () => {
  await updateBadgeForActiveTab();
});

browser.windows.onFocusChanged.addListener(async () => {
  await updateBadgeForActiveTab();
});

browser.storage.onChanged.addListener(async () => {
  await updateBadgeForActiveTab();
});

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type === "GET_STATE") {
    const activeTab = await getActiveTab();
    return {
      activeTab: {
        url: activeTab?.url || "",
        title: activeTab?.title || "",
        host: getHostFromUrl(activeTab?.url || "")
      },
      mutedHosts: await getMutedHosts()
    };
  }

  if (msg?.type === "ADD_CURRENT_TAB") {
    const activeTab = await getActiveTab();
    const host = getHostFromUrl(activeTab?.url || "");
    if (!host) throw new Error("Current tab does not have a normal website URL.");
    await addMutedHost(host);
    return { ok: true, host };
  }

  if (msg?.type === "ADD_HOST") {
    const host = await addMutedHost(msg.host || "");
    return { ok: true, host };
  }

  if (msg?.type === "REMOVE_HOST") {
    await removeMutedHost(msg.host || "");
    return { ok: true };
  }

  if (msg?.type === "MUTE_CURRENT_NOW") {
    const activeTab = await getActiveTab();
    if (activeTab?.id) {
      try {
        await browser.tabs.update(activeTab.id, { muted: true });
      } catch {}
    }
    return { ok: true };
  }
});

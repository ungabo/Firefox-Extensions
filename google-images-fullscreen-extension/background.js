/* global browser */

const DEFAULT_ENABLED = true;

async function getEnabled() {
  const result = await browser.storage.local.get({ enabled: DEFAULT_ENABLED });
  return Boolean(result.enabled);
}

async function setBadge(enabled) {
  await browser.browserAction.setBadgeText({ text: enabled ? 'ON' : 'OFF' });
  await browser.browserAction.setBadgeBackgroundColor({ color: enabled ? '#267a2f' : '#7a2626' });
  await browser.browserAction.setTitle({ title: enabled ? 'Google Images Fullscreen: Enabled' : 'Google Images Fullscreen: Disabled' });
}

browser.runtime.onInstalled.addListener(async () => {
  const current = await browser.storage.local.get('enabled');
  if (typeof current.enabled === 'undefined') {
    await browser.storage.local.set({ enabled: DEFAULT_ENABLED });
  }
  await setBadge(await getEnabled());
});

browser.runtime.onStartup.addListener(async () => {
  await setBadge(await getEnabled());
});

browser.browserAction.onClicked.addListener(async (tab) => {
  const enabled = !(await getEnabled());
  await browser.storage.local.set({ enabled });
  await setBadge(enabled);

  if (tab && tab.id) {
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'GIFP_SET_ENABLED', enabled });
    } catch (e) {
      // Page may not have the content script loaded. Ignore.
    }
  }
});

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.enabled) {
    await setBadge(Boolean(changes.enabled.newValue));
  }
});

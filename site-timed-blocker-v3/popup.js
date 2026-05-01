let selectedHost = "";

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function getPopupState() {
  return await browser.runtime.sendMessage({ type: "GET_POPUP_STATE", selectedHost });
}

function fillSiteSelect(hosts, activeHost, currentSelected) {
  const siteSelect = document.getElementById("siteSelect");
  siteSelect.innerHTML = "";

  if (!hosts.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No saved sites";
    siteSelect.appendChild(option);
    siteSelect.disabled = true;
    return;
  }

  siteSelect.disabled = false;
  hosts.forEach(host => {
    const option = document.createElement("option");
    option.value = host;
    option.textContent = host === activeHost ? `${host} (current tab)` : host;
    siteSelect.appendChild(option);
  });

  siteSelect.value = currentSelected && hosts.includes(currentSelected)
    ? currentSelected
    : (activeHost && hosts.includes(activeHost) ? activeHost : hosts[0]);
}

function renderSiteStatus(site) {
  const statusEl = document.getElementById("siteStatus");
  const unblockBtn = document.getElementById("unblockBtn");
  const blockNowBtn = document.getElementById("blockNowBtn");
  const removeBtn = document.getElementById("removeBtn");
  const now = Date.now();

  if (!site || !site.host) {
    statusEl.textContent = "No managed site selected.";
    unblockBtn.disabled = true;
    blockNowBtn.disabled = true;
    removeBtn.disabled = true;
    return;
  }

  removeBtn.disabled = false;

  if (site.mode === "unblocked") {
    statusEl.textContent = `${site.host} is currently allowed. Re-blocks in ${formatRemaining(site.unblockUntil - now)}.`;
    unblockBtn.disabled = true;
    blockNowBtn.disabled = false;
    return;
  }

  if (site.mode === "cooldown") {
    statusEl.textContent = `${site.host} is blocked. Unblock is locked for ${formatRemaining(site.cooldownUntil - now)}.`;
    unblockBtn.disabled = true;
    blockNowBtn.disabled = true;
    return;
  }

  statusEl.textContent = `${site.host} is blocked. You may unblock it temporarily.`;
  unblockBtn.disabled = false;
  blockNowBtn.disabled = true;
}

async function refresh() {
  const state = await getPopupState();
  const activeInfo = document.getElementById("activeInfo");

  if (state.activeHost) {
    activeInfo.textContent = `Current tab host: ${state.activeHost}`;
  } else {
    activeInfo.textContent = "Current tab is not a normal website.";
  }

  fillSiteSelect(state.hosts, state.activeHost, state.selectedHost);
  selectedHost = document.getElementById("siteSelect").value || "";
  renderSiteStatus(state.selectedStatus && state.selectedStatus.host === selectedHost ? state.selectedStatus : (selectedHost ? {
    host: selectedHost,
    mode: "blocked",
    unblockUntil: 0,
    cooldownUntil: 0
  } : null));
}

document.getElementById("siteSelect").addEventListener("change", async (e) => {
  selectedHost = e.target.value || "";
  await refresh();
});

document.getElementById("addCurrentBtn").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "ADD_CURRENT_TAB" });
  await refresh();
});

document.getElementById("addManualBtn").addEventListener("click", async () => {
  const host = document.getElementById("manualHost").value.trim();
  if (!host) return;
  await browser.runtime.sendMessage({ type: "ADD_HOST", host });
  document.getElementById("manualHost").value = "";
  selectedHost = host;
  await refresh();
});

document.getElementById("unblockBtn").addEventListener("click", async () => {
  const minutes = parseInt(document.getElementById("minutes").value, 10);
  if (!selectedHost) return;
  await browser.runtime.sendMessage({ type: "UNBLOCK_HOST", host: selectedHost, minutes });
  await refresh();
});

document.getElementById("blockNowBtn").addEventListener("click", async () => {
  if (!selectedHost) return;
  await browser.runtime.sendMessage({ type: "BLOCK_HOST_NOW", host: selectedHost });
  await refresh();
});

document.getElementById("removeBtn").addEventListener("click", async () => {
  if (!selectedHost) return;
  await browser.runtime.sendMessage({ type: "REMOVE_HOST", host: selectedHost });
  selectedHost = "";
  await refresh();
});

refresh();
setInterval(refresh, 1000);

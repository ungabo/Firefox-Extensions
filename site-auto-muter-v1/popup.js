function setMessage(text, isError = false) {
  const el = document.getElementById("message");
  el.textContent = text || "";
  el.style.color = isError ? "#b00020" : "#444";
}

async function getState() {
  return browser.runtime.sendMessage({ type: "GET_STATE" });
}

function renderHostList(hosts) {
  const container = document.getElementById("hostList");
  container.innerHTML = "";

  if (!hosts.length) {
    container.textContent = "No sites saved.";
    return;
  }

  for (const host of hosts) {
    const row = document.createElement("div");
    row.className = "host-row";

    const name = document.createElement("div");
    name.className = "host-name";
    name.textContent = host;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      try {
        await browser.runtime.sendMessage({ type: "REMOVE_HOST", host });
        await refresh();
      } catch (err) {
        setMessage(err.message || String(err), true);
      }
    });

    row.appendChild(name);
    row.appendChild(removeBtn);
    container.appendChild(row);
  }
}

async function refresh() {
  const state = await getState();
  document.getElementById("currentHost").textContent = state.activeTab.host || "Not a normal website tab";
  document.getElementById("currentUrl").textContent = state.activeTab.url || "";
  renderHostList(state.mutedHosts || []);
}

document.getElementById("addCurrentBtn").addEventListener("click", async () => {
  try {
    const result = await browser.runtime.sendMessage({ type: "ADD_CURRENT_TAB" });
    setMessage(`Added ${result.host}`);
    await refresh();
  } catch (err) {
    setMessage(err.message || String(err), true);
  }
});

document.getElementById("addManualBtn").addEventListener("click", async () => {
  try {
    const input = document.getElementById("manualHost");
    const host = input.value.trim();
    if (!host) {
      setMessage("Enter a host first.", true);
      return;
    }
    const result = await browser.runtime.sendMessage({ type: "ADD_HOST", host });
    input.value = "";
    setMessage(`Added ${result.host}`);
    await refresh();
  } catch (err) {
    setMessage(err.message || String(err), true);
  }
});

document.getElementById("muteNowBtn").addEventListener("click", async () => {
  try {
    await browser.runtime.sendMessage({ type: "MUTE_CURRENT_NOW" });
    setMessage("Current tab muted.");
  } catch (err) {
    setMessage(err.message || String(err), true);
  }
});

refresh().catch(err => setMessage(err.message || String(err), true));

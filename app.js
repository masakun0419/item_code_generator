(function () {
  const state = {
    items: [],
    filteredItems: [],
    prefixes: [],
    history: [],
    pendingPreset: null,
  };

  const HISTORY_KEY = "item_code_gen_history_v1";

  const el = {
    loadStatus: document.getElementById("loadStatus"),
    itemSearch: document.getElementById("itemSearch"),
    itemSelect: document.getElementById("itemSelect"),
    selectedItemId: document.getElementById("selectedItemId"),
    btnAddOp: document.getElementById("btnAddOp"),
    opRows: document.getElementById("opRows"),
    btnGenerate: document.getElementById("btnGenerate"),
    btnCopy: document.getElementById("btnCopy"),
    btnShareUrl: document.getElementById("btnShareUrl"),
    presetMemo: document.getElementById("presetMemo"),
    btnSaveHistory: document.getElementById("btnSaveHistory"),
    commandOutput: document.getElementById("commandOutput"),
    opRowTemplate: document.getElementById("opRowTemplate"),
    btnExportHistory: document.getElementById("btnExportHistory"),
    btnImportHistory: document.getElementById("btnImportHistory"),
    btnClearHistory: document.getElementById("btnClearHistory"),
    historyJson: document.getElementById("historyJson"),
    historyList: document.getElementById("historyList"),
    toast: document.getElementById("toast"),
  };
  let toastTimer = null;

  function setStatus(msg) {
    if (!el.loadStatus) return;
    el.loadStatus.textContent = msg;
  }

  function showToast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove("show");
    }, 1400);
  }

  function normalizeItemJson(raw) {
    const list = Array.isArray(raw) ? raw : (raw["アイテム一覧"] || []);
    return list
      .map((entry) => {
        const b = entry["基本情報"] || {};
        const id = Number(b["シリアル"]);
        const name = String(b["名前"] || "");
        const type = String(b["種類"] || "");
        if (!Number.isFinite(id) || !name) return null;
        return { id, name, type };
      })
      .filter(Boolean);
  }

  function normalizePrefixJson(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return list
      .map((p) => ({
        code: Number(p.discernment_code),
        name: String(p.name || ""),
        v1Min: Number(p.value1_min),
        v1Max: Number(p.value1_max),
        v2Min: Number(p.value2_min),
        v2Max: Number(p.value2_max),
      }))
      .filter((p) => Number.isFinite(p.code))
      .sort((a, b) => a.code - b.code);
  }

  async function loadJsonViaFetch(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(path + " load failed");
    const buf = await res.arrayBuffer();
    return parseJsonFromBuffer(buf);
  }

  async function autoLoad() {
      setStatus("");
    try {
      const [itemsRaw, prefixRaw] = await Promise.all([
        loadJsonViaFetch("./all_items.json"),
        loadJsonViaFetch("./prefix_map.json"),
      ]);
      state.items = normalizeItemJson(itemsRaw);
      state.prefixes = normalizePrefixJson(prefixRaw);
      state.filteredItems = state.items.slice();
      renderItemList();
      refreshAllOpRows();
      if (state.pendingPreset) {
        applyPreset(state.pendingPreset);
        state.pendingPreset = null;
      }
      setStatus("");
    } catch (e) {
      setStatus("JSON自動読込に失敗しました（手動ファイル選択を使用してください）");
    }
  }

  function readFileJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const buf = reader.result;
          resolve(parseJsonFromBuffer(buf));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function parseJsonFromBuffer(arrayBuffer) {
    const encodings = ["utf-8", "shift-jis", "euc-kr", "cp949", "windows-1252"];
    let lastError = null;

    for (const enc of encodings) {
      try {
        const decoder = new TextDecoder(enc, { fatal: true });
        const text = decoder.decode(arrayBuffer);
        return parseJsonWithCleanup(text);
      } catch (e) {
        lastError = e;
      }
    }

    throw lastError || new Error("json decode failed");
  }

  function parseJsonWithCleanup(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      // Fallback for malformed JSON containing raw control characters in strings.
      const cleaned = text.replace(/[\u0000-\u001F]/g, "");
      return JSON.parse(cleaned);
    }
  }

  function renderItemList() {
    const q = el.itemSearch.value.trim().toLowerCase();
    state.filteredItems = state.items.filter((it) => {
      if (!q) return true;
      return (
        String(it.id).includes(q) ||
        it.name.toLowerCase().includes(q) ||
        it.type.toLowerCase().includes(q)
      );
    });

    el.itemSelect.innerHTML = "";
    for (const it of state.filteredItems) {
      const op = document.createElement("option");
      op.value = String(it.id);
      op.textContent = `${it.id} | ${it.name} | ${it.type}`;
      el.itemSelect.appendChild(op);
    }
    if (el.itemSelect.options.length > 0) el.itemSelect.selectedIndex = 0;
    updateSelectedItem();
  }

  function updateSelectedItem() {
    const v = el.itemSelect.value;
    el.selectedItemId.textContent = v || "-";
  }

  function buildRangeOptions(selectEl, min, max) {
    selectEl.innerHTML = "";
    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) ? max : safeMin;
    for (let v = safeMin; v <= safeMax; v++) {
      const op = document.createElement("option");
      op.value = String(v);
      op.textContent = String(v);
      selectEl.appendChild(op);
    }
  }

  function renderPrefixList(selectEl, searchValue) {
    const q = (searchValue || "").trim().toLowerCase();
    selectEl.innerHTML = "";
    for (const p of state.prefixes) {
      const text = `${p.code} | ${p.name}`;
      if (q && !text.toLowerCase().includes(q)) continue;
      const op = document.createElement("option");
      op.value = String(p.code);
      op.textContent = text;
      selectEl.appendChild(op);
    }
    if (selectEl.options.length > 0 && selectEl.selectedIndex < 0) {
      selectEl.selectedIndex = 0;
    }
  }

  function updateOpRowBySelection(row) {
    const opSelect = row.querySelector(".opSelect");
    const v1Select = row.querySelector(".v1Select");
    const v2Select = row.querySelector(".v2Select");
    const opMeta = row.querySelector(".opMeta");
    const code = Number(opSelect.value);
    const p = state.prefixes.find((x) => x.code === code);
    if (!p) {
      v1Select.innerHTML = "";
      v2Select.innerHTML = "";
      opMeta.textContent = "";
      return;
    }
    buildRangeOptions(v1Select, p.v1Min, p.v1Max);
    buildRangeOptions(v2Select, p.v2Min, p.v2Max);
    opMeta.textContent = `range: v1(${p.v1Min}~${p.v1Max}), v2(${p.v2Min}~${p.v2Max})`;
  }

  function addOpRow() {
    const currentCount = el.opRows.querySelectorAll(".opRow").length;
    if (currentCount >= 3) {
      setStatus("");
      return;
    }

    const row = el.opRowTemplate.content.firstElementChild.cloneNode(true);
    const opSearch = row.querySelector(".opSearch");
    const opSelect = row.querySelector(".opSelect");
    const btnRemove = row.querySelector(".btnRemoveOp");

    renderPrefixList(opSelect, "");
    updateOpRowBySelection(row);

    opSearch.addEventListener("input", () => {
      const current = opSelect.value;
      renderPrefixList(opSelect, opSearch.value);
      for (let i = 0; i < opSelect.options.length; i++) {
        if (opSelect.options[i].value === current) {
          opSelect.selectedIndex = i;
          break;
        }
      }
      updateOpRowBySelection(row);
    });
    opSelect.addEventListener("change", () => updateOpRowBySelection(row));
    btnRemove.addEventListener("click", () => row.remove());

    el.opRows.appendChild(row);
  }

  function refreshAllOpRows() {
    const rows = el.opRows.querySelectorAll(".opRow");
    rows.forEach((row) => {
      const opSearch = row.querySelector(".opSearch");
      const opSelect = row.querySelector(".opSelect");
      const prev = opSelect.value;

      renderPrefixList(opSelect, opSearch.value);
      if (prev) {
        for (let i = 0; i < opSelect.options.length; i++) {
          if (opSelect.options[i].value === prev) {
            opSelect.selectedIndex = i;
            break;
          }
        }
      }
      updateOpRowBySelection(row);
    });
  }

  function generateCommand() {
    const itemId = Number(el.itemSelect.value);
    if (!Number.isFinite(itemId)) {
      el.commandOutput.value = "アイテムが選択されていません";
      return;
    }
    const parts = ["@item", String(itemId)];
    const rows = el.opRows.querySelectorAll(".opRow");
    rows.forEach((row) => {
      const code = row.querySelector(".opSelect").value;
      const v1 = row.querySelector(".v1Select").value;
      const v2 = row.querySelector(".v2Select").value;
      if (code !== "" && v1 !== "" && v2 !== "") {
        parts.push(code, v1, v2);
      }
    });
    el.commandOutput.value = parts.join(" ");
    return el.commandOutput.value;
  }

  async function copyCommand() {
    const text = el.commandOutput.value.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("");
      showToast("コピーしました");
    } catch (e) {
      setStatus("コピーに失敗しました");
      showToast("コピーに失敗しました");
    }
  }

  function getCurrentPreset() {
    const itemId = Number(el.itemSelect.value);
    if (!Number.isFinite(itemId)) return null;
    const ops = [];
    el.opRows.querySelectorAll(".opRow").forEach((row) => {
      const code = Number(row.querySelector(".opSelect").value);
      const v1 = Number(row.querySelector(".v1Select").value);
      const v2 = Number(row.querySelector(".v2Select").value);
      if (Number.isFinite(code) && Number.isFinite(v1) && Number.isFinite(v2)) {
        ops.push({ code, v1, v2 });
      }
    });
    const command = generateCommand();
    return {
      version: 1,
      itemId,
      ops,
      memo: (el.presetMemo.value || "").trim(),
      command,
      createdAt: new Date().toISOString(),
    };
  }

  function applyPreset(preset) {
    if (!preset || !Number.isFinite(Number(preset.itemId))) return;
    const itemId = String(Number(preset.itemId));
    for (let i = 0; i < el.itemSelect.options.length; i++) {
      if (el.itemSelect.options[i].value === itemId) {
        el.itemSelect.selectedIndex = i;
        break;
      }
    }
    updateSelectedItem();

    el.opRows.innerHTML = "";
    const ops = Array.isArray(preset.ops) ? preset.ops.slice(0, 3) : [];
    if (ops.length === 0) addOpRow();
    ops.forEach((op) => {
      addOpRow();
      const row = el.opRows.lastElementChild;
      const opSelect = row.querySelector(".opSelect");
      const v1Select = row.querySelector(".v1Select");
      const v2Select = row.querySelector(".v2Select");

      for (let i = 0; i < opSelect.options.length; i++) {
        if (Number(opSelect.options[i].value) === Number(op.code)) {
          opSelect.selectedIndex = i;
          break;
        }
      }
      updateOpRowBySelection(row);
      for (let i = 0; i < v1Select.options.length; i++) {
        if (Number(v1Select.options[i].value) === Number(op.v1)) {
          v1Select.selectedIndex = i;
          break;
        }
      }
      for (let i = 0; i < v2Select.options.length; i++) {
        if (Number(v2Select.options[i].value) === Number(op.v2)) {
          v2Select.selectedIndex = i;
          break;
        }
      }
    });

    el.presetMemo.value = preset.memo || "";
    generateCommand();
  }

  function loadHistory() {
    try {
      state.history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      if (!Array.isArray(state.history)) state.history = [];
    } catch (e) {
      state.history = [];
    }
    renderHistory();
  }

  function saveHistoryStorage() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  }

  function renderHistory() {
    el.historyList.innerHTML = "";
    state.history.forEach((h, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "historyItem";

      const title = document.createElement("div");
      title.className = "historyTitle";
      title.textContent = `${h.memo || "メモなし"} | item=${h.itemId} | ${new Date(h.createdAt).toLocaleString()}`;
      wrap.appendChild(title);

      const cmd = document.createElement("div");
      cmd.className = "historyCmd";
      cmd.textContent = h.command || "";
      wrap.appendChild(cmd);

      const row = document.createElement("div");
      row.className = "row";

      const btnLoad = document.createElement("button");
      btnLoad.textContent = "復元";
      btnLoad.addEventListener("click", () => applyPreset(h));
      row.appendChild(btnLoad);

      const btnCopy = document.createElement("button");
      btnCopy.textContent = "コマンドコピー";
      btnCopy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(h.command || "");
        showToast("コピーしました");
      });
      row.appendChild(btnCopy);

      const btnShare = document.createElement("button");
      btnShare.textContent = "共有URL";
      btnShare.addEventListener("click", async () => {
        const url = createShareUrl(h);
        await navigator.clipboard.writeText(url);
        showToast("共有URLをコピーしました");
      });
      row.appendChild(btnShare);

      const btnDel = document.createElement("button");
      btnDel.textContent = "削除";
      btnDel.addEventListener("click", () => {
        state.history.splice(idx, 1);
        saveHistoryStorage();
        renderHistory();
        showToast("履歴を削除しました");
      });
      row.appendChild(btnDel);

      wrap.appendChild(row);
      el.historyList.appendChild(wrap);
    });
  }

  function createShareUrl(preset) {
    const json = JSON.stringify(preset);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `${location.origin}${location.pathname}#preset=${b64}`;
  }

  function parsePresetFromHash() {
    const h = location.hash || "";
    const key = "#preset=";
    if (!h.startsWith(key)) return null;
    try {
      const b64 = h.slice(key.length).replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
      const bin = atob(b64 + pad);
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      const json = new TextDecoder().decode(bytes);
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function saveCurrentToHistory() {
    const preset = getCurrentPreset();
    if (!preset) return;
    state.history.unshift(preset);
    if (state.history.length > 100) state.history.length = 100;
    saveHistoryStorage();
    renderHistory();
    showToast("履歴に保存しました");
  }

  function exportHistoryJson() {
    el.historyJson.value = JSON.stringify(state.history, null, 2);
    showToast("履歴JSONを出力しました");
  }

  function importHistoryJson() {
    try {
      const arr = JSON.parse(el.historyJson.value || "[]");
      if (!Array.isArray(arr)) throw new Error("invalid");
      state.history = arr.concat(state.history).slice(0, 100);
      saveHistoryStorage();
      renderHistory();
      setStatus("");
      showToast("履歴JSONを取り込みました");
    } catch (e) {
      setStatus("履歴JSON取込に失敗しました");
      showToast("履歴JSON取込に失敗しました");
    }
  }

  el.itemSearch.addEventListener("input", renderItemList);
  el.itemSelect.addEventListener("change", updateSelectedItem);
  el.btnAddOp.addEventListener("click", addOpRow);
  el.btnGenerate.addEventListener("click", generateCommand);
  el.btnCopy.addEventListener("click", copyCommand);
  el.btnShareUrl.addEventListener("click", async () => {
    const preset = getCurrentPreset();
    if (!preset) return;
    const url = createShareUrl(preset);
    el.commandOutput.value = url;
    await navigator.clipboard.writeText(url);
    showToast("共有URLをコピーしました");
  });
  el.btnSaveHistory.addEventListener("click", saveCurrentToHistory);
  el.btnExportHistory.addEventListener("click", exportHistoryJson);
  el.btnImportHistory.addEventListener("click", importHistoryJson);
  el.btnClearHistory.addEventListener("click", () => {
    state.history = [];
    saveHistoryStorage();
    renderHistory();
    showToast("履歴を全削除しました");
  });

  addOpRow();
  if (location.protocol === "file:") {
    setStatus("file:// で開いています。自動読込は失敗する場合があります。");
  }
  autoLoad();
  loadHistory();

  state.pendingPreset = parsePresetFromHash();
})();

(function () {
  const state = {
    items: [],
    filteredItems: [],
    prefixes: [],
  };

  const el = {
    loadStatus: document.getElementById("loadStatus"),
    itemSearch: document.getElementById("itemSearch"),
    itemSelect: document.getElementById("itemSelect"),
    selectedItemId: document.getElementById("selectedItemId"),
    btnAddOp: document.getElementById("btnAddOp"),
    opRows: document.getElementById("opRows"),
    btnGenerate: document.getElementById("btnGenerate"),
    btnCopy: document.getElementById("btnCopy"),
    commandOutput: document.getElementById("commandOutput"),
    opRowTemplate: document.getElementById("opRowTemplate"),
  };

  function setStatus(msg) {
    if (!el.loadStatus) return;
    el.loadStatus.textContent = msg;
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
  }

  async function copyCommand() {
    const text = el.commandOutput.value.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("");
    } catch (e) {
      setStatus("コピーに失敗しました");
    }
  }

  el.itemSearch.addEventListener("input", renderItemList);
  el.itemSelect.addEventListener("change", updateSelectedItem);
  el.btnAddOp.addEventListener("click", addOpRow);
  el.btnGenerate.addEventListener("click", generateCommand);
  el.btnCopy.addEventListener("click", copyCommand);

  addOpRow();
  if (location.protocol === "file:") {
    setStatus("file:// で開いています。自動読込は失敗する場合があります。");
  }
  autoLoad();
})();

"use strict";
const $ = (id) => document.getElementById(id),
  E = ReviewEngine;
const items = [],
  thumbURLs = new Map();
let active = null,
  work = null,
  original = null,
  restoreSource = null,
  bgImage = null,
  tool = "none",
  samplePoint = null,
  cloneOffset = null,
  stroke = null,
  compare = false,
  busy = false,
  dbPromise = null,
  renderPending = false,
  toastTimer = null,
  exportFiles = [],
  exportURLs = [],
  exportBatch = false,
  activeTab = "tone",
  loadVersion = 0;
const history = new Map(),
  saveTimers = new Map();
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4200);
}
function setBusy(value, message = "처리 중…") {
  busy = value;
  $("busyOverlay").hidden = !value;
  $("busyText").textContent = message;
}
async function task(message, fn) {
  if (busy) return;
  setBusy(true, message);
  await new Promise((r) => setTimeout(r, 30));
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    toast(error.message || "처리하지 못했습니다. 다시 시도해 주세요.");
  } finally {
    setBusy(false);
  }
}
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function toBlob(c, type = "image/png", quality = 0.94) {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("사진을 저장 파일로 바꾸지 못했습니다.")),
      type,
      quality,
    ),
  );
}
async function decode(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(
      "이 사진 형식을 읽지 못했습니다. JPEG 또는 PNG로 다시 넣어주세요.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
function copyCanvas(source) {
  const c = canvas(source.width, source.height);
  c.getContext("2d").drawImage(source, 0, 0);
  return c;
}
async function blobCanvas(blob) {
  const img = await decode(blob);
  if (img.naturalWidth * img.naturalHeight > 100000000)
    throw new Error("사진이 너무 큽니다. 크기를 줄여 다시 넣어주세요.");
  const scale = Math.min(
    1,
    2400 / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const c = canvas(img.naturalWidth * scale, img.naturalHeight * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}
function openDB() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("review-studio", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("photos", { keyPath: "id" });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("다른 창을 닫고 다시 시도해 주세요."));
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  return dbPromise;
}
async function dbWrite(item) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readwrite");
      tx.objectStore("photos").put(item);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    $("saveStatus").textContent = "변경 사항을 이 기기에 보관했습니다.";
    return true;
  } catch {
    $("saveStatus").textContent =
      "기기 보관 실패 · 창을 닫기 전 완성본을 저장하세요.";
    toast("기기 보관에 실패했습니다. 완성본을 파일로 저장해 주세요.");
    return false;
  }
}
async function dbRead() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readonly"),
      req = tx.objectStore("photos").getAll();
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readwrite");
    tx.objectStore("photos").delete(id);
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
function scheduleSave() {
  if (!active) return;
  const item = active;
  clearTimeout(saveTimers.get(item.id));
  saveTimers.set(
    item.id,
    setTimeout(() => {
      saveTimers.delete(item.id);
      dbWrite(item);
    }, 350),
  );
  $("saveStatus").textContent = "변경 사항 보관 중…";
}
function thumbnailURL(item) {
  if (!thumbURLs.has(item.id))
    thumbURLs.set(item.id, URL.createObjectURL(item.thumb));
  return thumbURLs.get(item.id);
}
function renderLibrary() {
  $("photoCount").textContent = items.length;
  $("photoList").replaceChildren(
    ...items.map((item) => {
      const button = document.createElement("button");
      button.className =
        "photo-card" + (active?.id === item.id ? " active" : "");
      button.setAttribute("aria-label", item.name + " 편집");
      button.setAttribute("aria-pressed", String(active?.id === item.id));
      const img = new Image();
      img.src = thumbnailURL(item);
      img.alt = "";
      const name = document.createElement("span");
      name.textContent = item.name;
      button.append(img, name);
      button.addEventListener("click", () => {
        if (!busy && !stroke) selectPhoto(item);
      });
      return button;
    }),
  );
  for (const id of [
    "batchBtn",
    "exportAllBtn",
    "exportBtn",
    "compareBtn",
    "resetBtn",
    "rotateBtn",
  ])
    $(id).disabled = !active;
  $("empty").hidden = !!active;
  $("preview").hidden = !active;
}
async function selectPhoto(item) {
  const version = ++loadVersion;
  try {
    const [nextWork, nextOriginal, nextRestore, nextBg] = await Promise.all([
      blobCanvas(item.working),
      blobCanvas(item.original),
      blobCanvas(item.restoreBase || item.original),
      item.bgBlob ? decode(item.bgBlob) : Promise.resolve(null),
    ]);
    if (version !== loadVersion) return;
    active = item;
    work = nextWork;
    original = nextOriginal;
    restoreSource = nextRestore;
    bgImage = nextBg;
    samplePoint = null;
    setTool("none");
    compare = false;
    syncControls();
    renderLibrary();
    render();
  } catch (error) {
    toast(error.message);
  }
}
const fields = [
  ["exposure", "밝기", -70, 70],
  ["contrast", "대비", -50, 50],
  ["saturation", "채도", -60, 60],
  ["warmth", "색온도", -40, 40],
  ["shadows", "어두운 부분", -40, 60],
];
for (const [key, label, min, max] of fields) {
  const wrap = document.createElement("label");
  wrap.className = "slider-label";
  wrap.textContent = label;
  const out = document.createElement("output");
  out.id = key + "Value";
  out.textContent = "0";
  const input = document.createElement("input");
  Object.assign(input, { type: "range", min, max, value: 0, id: key });
  input.addEventListener("pointerdown", () => {
    if (active && !busy) pushHistory();
  });
  input.addEventListener("keydown", (event) => {
    if (
      active &&
      !busy &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      pushHistory();
  });
  input.addEventListener("input", () => {
    if (!active || busy) return;
    active.settings[key] = Number(input.value);
    out.value = input.value;
    compare = false;
    requestRender();
    scheduleSave();
  });
  wrap.append(out, input);
  $("toneSliders").append(wrap);
}
function syncControls() {
  if (!active) return;
  for (const [key] of fields) {
    $(key).value = active.settings[key];
    $(key + "Value").value = active.settings[key];
  }
  $("cropRatio").value = active.crop;
  $("cropX").value = active.cropX;
  $("cropY").value = active.cropY;
  $("imageTitle").textContent = active.name;
  $("imageSize").textContent = work.width + " × " + work.height;
  $("compareBtn").setAttribute("aria-pressed", String(compare));
  $("undoBtn").disabled = !history.get(active.id)?.length;
  document
    .querySelectorAll("[data-color]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(active.background === button.dataset.color && !active.bgBlob),
      ),
    );
}
function cropFor(item, c) {
  return E.cropRect(c.width, c.height, item.crop, item.cropX, item.cropY);
}
function paintOutput(
  c,
  item,
  source,
  maxSide,
  backgroundImage,
  unmodified = false,
) {
  const crop = unmodified
      ? { x: 0, y: 0, width: source.width, height: source.height }
      : cropFor(item, source),
    scale = Math.min(1, maxSide / Math.max(crop.width, crop.height));
  c.width = Math.max(1, Math.round(crop.width * scale));
  c.height = Math.max(1, Math.round(crop.height * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    c.width,
    c.height,
  );
  if (!unmodified) {
    const image = ctx.getImageData(0, 0, c.width, c.height);
    E.applyTone(image.data, item.settings);
    ctx.putImageData(image, 0, 0);
    ctx.globalCompositeOperation = "destination-over";
    if (backgroundImage) {
      const bgCrop = E.cropRect(
        backgroundImage.naturalWidth,
        backgroundImage.naturalHeight,
        c.width / c.height,
      );
      ctx.drawImage(
        backgroundImage,
        bgCrop.x,
        bgCrop.y,
        bgCrop.width,
        bgCrop.height,
        0,
        0,
        c.width,
        c.height,
      );
    } else if (item.background !== "transparent") {
      ctx.fillStyle = item.background;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.globalCompositeOperation = "source-over";
  }
  return c;
}
function render() {
  renderPending = false;
  if (!active || !work) return;
  paintOutput(
    $("preview"),
    active,
    compare ? original : work,
    1000,
    compare ? null : bgImage,
    compare,
  );
  $("beforeBadge").hidden = !compare;
  $("compareBtn").setAttribute("aria-pressed", String(compare));
  $("preview").classList.toggle("editing", tool !== "none" && !compare);
  $("undoBtn").disabled = !history.get(active.id)?.length;
}
function requestRender() {
  if (!renderPending) {
    renderPending = true;
    requestAnimationFrame(render);
  }
}
function setTool(value) {
  tool = value;
  samplePoint = value === "sample" ? null : samplePoint;
  cloneOffset = null;
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.tool === value)),
    );
  $("pickBgBtn").setAttribute("aria-pressed", String(value === "pick"));
  const hints = {
    none: "색감을 맞춘 뒤 원본과 비교하고 저장하세요.",
    pick: "지울 배경을 사진에서 짚으세요. 비슷한 색이 이어진 영역을 지웁니다.",
    erase: "지울 부분을 문지르세요. 되돌리기로 취소할 수 있어요.",
    restore: "지웠던 부분을 문지르면 원본의 해당 영역을 되살립니다.",
    sample: "복사할 깨끗한 영역을 사진에서 한 번 짚으세요.",
    clone: samplePoint
      ? "가릴 부분을 문지르세요. 선택한 곳과 같은 간격으로 복사됩니다."
      : "먼저 ‘복사할 곳 선택’으로 깨끗한 영역을 짚으세요.",
  };
  $("toolHint").textContent = active
    ? hints[value]
    : "사진을 추가하면 편집을 시작할 수 있어요.";
  compare = false;
  if (active) render();
}
function setTab(tab) {
  activeTab = tab;
  for (const name of ["tone", "background", "retouch"])
    $(name + "Panel").hidden = name !== tab;
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.tab === tab)),
    );
  setTool("none");
}
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
document.querySelectorAll("[data-tool]").forEach((b) =>
  b.addEventListener("click", () => {
    if (active && !busy) setTool(b.dataset.tool);
    else toast("먼저 사진을 선택해 주세요.");
  }),
);
$("pickBgBtn").addEventListener("click", () => {
  if (active && !busy) setTool(tool === "pick" ? "none" : "pick");
  else toast("먼저 사진을 선택해 주세요.");
});
document.querySelectorAll("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!active || busy) return;
    pushHistory();
    active.settings = { ...E.PRESETS[b.dataset.preset] };
    syncControls();
    render();
    scheduleSave();
  }),
);
$("autoBtn").addEventListener("click", () => {
  if (!active || busy) return;
  pushHistory();
  const c = canvas(160, Math.max(1, (work.height / work.width) * 160));
  c.getContext("2d").drawImage(work, 0, 0, c.width, c.height);
  active.settings.exposure = E.autoExposure(
    c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
  );
  syncControls();
  render();
  scheduleSave();
  toast("사진 전체 밝기를 기준으로 맞췄습니다. 제품 색을 확인해 주세요.");
});
$("compareBtn").addEventListener("click", () => {
  if (!active || busy) return;
  compare = !compare;
  render();
});
$("cropRatio").addEventListener("input", () => {
  if (active && !busy) pushHistory();
});
for (const id of ["cropX", "cropY"])
  $(id).addEventListener("pointerdown", () => {
    if (active && !busy) pushHistory();
  });
for (const id of ["cropRatio", "cropX", "cropY"])
  $(id).addEventListener("input", () => {
    if (!active || busy) return;
    active.crop = $("cropRatio").value;
    active.cropX = Number($("cropX").value);
    active.cropY = Number($("cropY").value);
    compare = false;
    render();
    scheduleSave();
  });
$("batchBtn").addEventListener("click", () =>
  task("모든 사진에 색감 적용 중…", async () => {
    if (!active) return;
    for (const item of items) {
      item.settings = { ...active.settings };
      await dbWrite(item);
    }
    toast(
      "색감을 모든 사진에 적용했습니다. 배경과 자르기는 각 사진 설정을 유지합니다.",
    );
  }),
);
$("tolerance").addEventListener(
  "input",
  () => ($("toleranceValue").value = $("tolerance").value),
);
for (const [id, out, other] of [
  ["brushSize", "brushValue", "cloneSize"],
  ["cloneSize", "cloneValue", "brushSize"],
])
  $(id).addEventListener("input", () => {
    $(out).value = $(id).value;
    $(other).value = $(id).value;
    $(other === "brushSize" ? "brushValue" : "cloneValue").value = $(id).value;
  });
async function addFiles(files) {
  await task("사진 불러오는 중…", async () => {
    let added = 0,
      failed = 0,
      first = null;
    for (const file of Array.from(files)) {
      if (items.length >= 20) {
        toast("한 번에 최대 20장까지 보관할 수 있어요.");
        break;
      }
      if (file.size > 45 * 1024 * 1024) {
        failed++;
        continue;
      }
      try {
        const c = await blobCanvas(file),
          thumb = canvas(160, (c.height / c.width) * 160);
        thumb.getContext("2d").drawImage(c, 0, 0, thumb.width, thumb.height);
        const normalized = await toBlob(c),
          item = {
            id: crypto.randomUUID(),
            name: file.name || "제품 사진",
            original: normalized,
            working: normalized,
            thumb: await toBlob(thumb, "image/jpeg", 0.8),
            settings: { ...E.DEFAULTS },
            background: "transparent",
            bgBlob: null,
            crop: "original",
            cropX: 50,
            cropY: 50,
            createdAt: Date.now(),
          };
        items.push(item);
        await dbWrite(item);
        first = first || item;
        added++;
      } catch {
        failed++;
      }
    }
    if (first) await selectPhoto(first);
    renderLibrary();
    if (failed)
      toast(
        `${added}장 추가 · ${failed}장은 크기 또는 형식 문제로 읽지 못했습니다. JPEG로 다시 넣어주세요.`,
      );
  });
}
$("photoInput").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files);
  event.target.value = "";
  await addFiles(files);
});
function pushHistory() {
  if (!active || !work) return;
  const snapshot = copyCanvas(work),
    entry = {
      blob: toBlob(snapshot),
      settings: { ...active.settings },
      restoreBase: active.restoreBase || null,
      crop: active.crop,
      cropX: active.cropX,
      cropY: active.cropY,
      background: active.background,
      bgBlob: active.bgBlob,
    };
  let list = history.get(active.id);
  if (!list) {
    list = [];
    history.set(active.id, list);
  }
  list.push(entry);
  if (list.length > 6) list.shift();
  $("undoBtn").disabled = false;
}
async function commitPixels(item = active) {
  if (!item || !work) return;
  item.working = await toBlob(work);
  await dbWrite(item);
}
$("undoBtn").addEventListener("click", () =>
  task("되돌리는 중…", async () => {
    if (!active) return;
    const entry = history.get(active.id)?.pop();
    if (!entry) return;
    work = await blobCanvas(await entry.blob);
    restoreSource = await blobCanvas(entry.restoreBase || active.original);
    Object.assign(active, {
      settings: { ...entry.settings },
      restoreBase: entry.restoreBase,
      crop: entry.crop,
      cropX: entry.cropX,
      cropY: entry.cropY,
      background: entry.background,
      bgBlob: entry.bgBlob,
    });
    bgImage = entry.bgBlob ? await decode(entry.bgBlob) : null;
    samplePoint = null;
    await commitPixels();
    syncControls();
    render();
  }),
);
$("resetBtn").addEventListener("click", () =>
  task("원본으로 복원 중…", async () => {
    if (
      !active ||
      !confirm("색감, 배경, 부분 수정을 모두 취소하고 원본으로 돌아갈까요?")
    )
      return;
    pushHistory();
    work = copyCanvas(original);
    restoreSource = copyCanvas(original);
    Object.assign(active, {
      restoreBase: null,
      working: active.original,
      settings: { ...E.DEFAULTS },
      background: "transparent",
      bgBlob: null,
      crop: "original",
      cropX: 50,
      cropY: 50,
    });
    bgImage = null;
    setTool("none");
    await dbWrite(active);
    syncControls();
    render();
  }),
);
$("rotateBtn").addEventListener("click", () =>
  task("사진 회전 중…", async () => {
    if (!active) return;
    pushHistory();
    const c = canvas(work.height, work.width),
      ctx = c.getContext("2d");
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(work, 0, 0);
    const restored = canvas(restoreSource.height, restoreSource.width),
      rctx = restored.getContext("2d");
    rctx.translate(restored.width, 0);
    rctx.rotate(Math.PI / 2);
    rctx.drawImage(restoreSource, 0, 0);
    restoreSource = restored;
    active.restoreBase = await toBlob(restored);
    work = c;
    active.crop = "original";
    active.cropX = active.cropY = 50;
    samplePoint = null;
    await commitPixels();
    syncControls();
    render();
    toast("사진을 회전했습니다.");
  }),
);
for (const b of document.querySelectorAll("[data-color]"))
  b.addEventListener("click", () => {
    if (!active || busy) return;
    pushHistory();
    active.background = b.dataset.color;
    active.bgBlob = null;
    bgImage = null;
    syncControls();
    render();
    scheduleSave();
  });
$("bgColor").addEventListener("pointerdown", () => {
  if (active && !busy) pushHistory();
});
$("bgColor").addEventListener("input", () => {
  if (!active || busy) return;
  active.background = $("bgColor").value;
  active.bgBlob = null;
  bgImage = null;
  render();
  scheduleSave();
});
$("backgroundInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || !active) return;
  await task("배경 사진 준비 중…", async () => {
    pushHistory();
    const bg = await blobCanvas(file);
    active.bgBlob = await toBlob(bg, "image/jpeg", 0.9);
    bgImage = await decode(active.bgBlob);
    render();
    await dbWrite(active);
  });
});
function point(event) {
  const rect = $("preview").getBoundingClientRect(),
    crop = cropFor(active, work);
  return {
    x: crop.x + ((event.clientX - rect.left) / rect.width) * crop.width,
    y: crop.y + ((event.clientY - rect.top) / rect.height) * crop.height,
    brush: (Number($("brushSize").value) / rect.width) * crop.width,
  };
}
function dab(p) {
  const ctx = work.getContext("2d"),
    radius = p.brush / 2;
  if (tool === "erase") {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const fade = ctx.createRadialGradient(
      p.x,
      p.y,
      radius * 0.65,
      p.x,
      p.y,
      radius,
    );
    fade.addColorStop(0, "#000");
    fade.addColorStop(1, "#0000");
    ctx.fillStyle = fade;
    ctx.fillRect(p.x - radius, p.y - radius, p.brush, p.brush);
    ctx.restore();
    return;
  }
  const source = tool === "restore" ? restoreSource : stroke?.source;
  if (!source) return;
  const size = Math.max(2, Math.min(512, Math.round(p.brush))),
    stamp = canvas(size, size),
    sc = stamp.getContext("2d"),
    offset = tool === "clone" ? cloneOffset : { x: 0, y: 0 };
  if (!offset) return;
  sc.drawImage(
    source,
    p.x - radius - offset.x,
    p.y - radius - offset.y,
    p.brush,
    p.brush,
    0,
    0,
    size,
    size,
  );
  sc.globalCompositeOperation = "destination-in";
  const fade = sc.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.32,
    size / 2,
    size / 2,
    size / 2,
  );
  fade.addColorStop(0, "#000");
  fade.addColorStop(1, "#0000");
  sc.fillStyle = fade;
  sc.fillRect(0, 0, size, size);
  ctx.drawImage(stamp, p.x - radius, p.y - radius, p.brush, p.brush);
}
$("preview").addEventListener("pointerdown", async (event) => {
  if (!active || busy || compare || tool === "none" || stroke) return;
  event.preventDefault();
  const p = point(event);
  if (tool === "sample") {
    samplePoint = { x: p.x, y: p.y };
    setTool("clone");
    toast("복사할 곳을 선택했습니다. 가릴 부분을 문지르세요.");
    return;
  }
  if (tool === "pick") {
    await task("선택한 배경 지우는 중…", async () => {
      pushHistory();
      const ctx = work.getContext("2d", { willReadFrequently: true }),
        pixels = ctx.getImageData(0, 0, work.width, work.height),
        count = E.removeConnected(
          pixels.data,
          work.width,
          work.height,
          p.x,
          p.y,
          Number($("tolerance").value),
        );
      ctx.putImageData(pixels, 0, 0);
      await commitPixels();
      render();
      toast(
        count
          ? "선택한 배경을 지웠습니다. 윤곽은 지우개·복원으로 다듬어 주세요."
          : "이미 투명한 곳입니다. 남은 배경을 선택해 주세요.",
      );
    });
    return;
  }
  if (tool === "clone" && !samplePoint) {
    toast("먼저 깨끗한 영역을 복사할 곳으로 선택해 주세요.");
    return;
  }
  pushHistory();
  const source = tool === "clone" ? copyCanvas(work) : null;
  stroke = { last: p, source, item: active, id: event.pointerId };
  if (tool === "clone" && !cloneOffset)
    cloneOffset = { x: p.x - samplePoint.x, y: p.y - samplePoint.y };
  $("preview").setPointerCapture(event.pointerId);
  dab(p);
  requestRender();
});
$("preview").addEventListener("pointermove", (event) => {
  if (!stroke || stroke.id !== event.pointerId) return;
  event.preventDefault();
  const p = point(event),
    last = stroke.last,
    dist = Math.hypot(p.x - last.x, p.y - last.y),
    steps = Math.max(1, Math.ceil(dist / Math.max(1, p.brush * 0.2)));
  for (let n = 1; n <= steps; n++)
    dab({
      x: last.x + ((p.x - last.x) * n) / steps,
      y: last.y + ((p.y - last.y) * n) / steps,
      brush: p.brush,
    });
  stroke.last = p;
  requestRender();
});
async function finishStroke(event) {
  if (!stroke || stroke.id !== event.pointerId) return;
  const item = stroke.item;
  stroke = null;
  await task("수정 내용 보관 중…", () => commitPixels(item));
  render();
}
$("preview").addEventListener("pointerup", finishStroke);
$("preview").addEventListener("pointercancel", finishStroke);
$("preview").addEventListener("lostpointercapture", finishStroke);
function clearExport() {
  for (const url of exportURLs) URL.revokeObjectURL(url);
  exportURLs = [];
  exportFiles = [];
  $("exportOptions").hidden = false;
  $("exportReady").hidden = true;
}
function openExport(batch) {
  if (!active || busy || stroke) return;
  clearExport();
  exportBatch = batch;
  $("exportTitle").textContent = batch ? "전체 사진 저장" : "사진 저장";
  $("exportDialog").showModal();
}
$("exportBtn").addEventListener("click", () => openExport(false));
$("exportAllBtn").addEventListener("click", () => openExport(true));
function exportName(item, index, type) {
  const name = item.name.replace(/\.[^.]*$/, "").replace(/[\\/:*?"<>|]/g, "-");
  return `${String(index + 1).padStart(2, "0")}-${name}-review.${type === "image/png" ? "png" : "jpg"}`;
}
$("prepareExportBtn").addEventListener("click", () =>
  task("저장할 사진을 만드는 중…", async () => {
    const selected = exportBatch ? items : [active],
      type = $("exportFormat").value,
      files = [];
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      $("busyText").textContent = `사진 준비 ${i + 1} / ${selected.length}`;
      const source = item === active ? work : await blobCanvas(item.working),
        bg = item.bgBlob
          ? item === active
            ? bgImage
            : await decode(item.bgBlob)
          : null;
      const out = paintOutput(canvas(1, 1), item, source, 2400, bg);
      if (type === "image/jpeg") {
        const ctx = out.getContext("2d");
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.globalCompositeOperation = "source-over";
      }
      const blob = await toBlob(out, type);
      files.push(
        new File([blob], exportName(item, i, type), { type: blob.type }),
      );
      await new Promise((r) => setTimeout(r, 0));
    }
    exportFiles = files;
    const firstURL = URL.createObjectURL(files[0]);
    exportURLs.push(firstURL);
    $("downloadLink").href = firstURL;
    $("downloadLink").download = files[0].name;
    $("downloadLink").textContent =
      files.length > 1 ? "첫 번째 사진 다운로드" : "사진 파일 다운로드";
    $("zipLink").hidden = files.length < 2;
    if (files.length > 1) {
      const zip = E.makeZip(
          await Promise.all(
            files.map(async (f) => ({
              name: f.name,
              bytes: new Uint8Array(await f.arrayBuffer()),
            })),
          ),
        ),
        url = URL.createObjectURL(zip);
      exportURLs.push(url);
      $("zipLink").href = url;
      $("zipLink").download = "review-studio-photos.zip";
    }
    $("shareBtn").hidden = !(
      navigator.share && navigator.canShare?.({ files })
    );
    $("exportMessage").textContent =
      `${files.length}장의 보정본이 준비됐어요. 저장 방식을 선택하세요.`;
    $("exportOptions").hidden = true;
    $("exportReady").hidden = false;
  }),
);
$("shareBtn").addEventListener("click", async () => {
  try {
    await navigator.share({ files: exportFiles });
    $("exportMessage").textContent =
      "공유 메뉴를 닫았습니다. 사진 앱이나 파일 앱에서 저장 결과를 확인하세요.";
  } catch (error) {
    if (error.name !== "AbortError")
      toast("공유하지 못했습니다. 파일 다운로드를 이용해 주세요.");
  }
});
$("helpBtn").addEventListener("click", () => $("helpDialog").showModal());
document
  .querySelectorAll("dialog")
  .forEach((dialog) =>
    dialog
      .querySelector("[data-close]")
      .addEventListener("click", () => dialog.close()),
  );
$("deletePhotoBtn").addEventListener("click", () =>
  task("사진 삭제 중…", async () => {
    if (
      !active ||
      !confirm(
        "현재 사진과 편집 내용을 이 기기 보관함에서 삭제할까요? 다운로드한 파일은 유지됩니다.",
      )
    )
      return;
    clearTimeout(saveTimers.get(active.id));
    saveTimers.delete(active.id);
    await dbDelete(active.id);
    const index = items.indexOf(active);
    items.splice(index, 1);
    URL.revokeObjectURL(thumbURLs.get(active.id));
    thumbURLs.delete(active.id);
    history.delete(active.id);
    active = null;
    work = original = null;
    bgImage = null;
    $("helpDialog").close();
    if (items.length)
      await selectPhoto(items[Math.min(index, items.length - 1)]);
    else {
      $("imageTitle").textContent = "좋은 사진의 마지막 손질.";
      $("imageSize").textContent = "";
      $("undoBtn").disabled = true;
      setTool("none");
      renderLibrary();
    }
  }),
);
async function sample() {
  if (busy) return;
  try {
    const response = await fetch("sample.svg");
    if (!response.ok) throw new Error("sample unavailable");
    const svg = await response.blob();
    await addFiles([
      new File([svg], "제품 사진 예시.svg", { type: "image/svg+xml" }),
    ]);
  } catch {
    toast(
      "예시를 불러오지 못했습니다. 연결 상태를 확인하거나 직접 사진을 선택하세요.",
    );
  }
}
$("sampleBtn").addEventListener("click", sample);
$("emptySampleBtn").addEventListener("click", sample);
(async () => {
  setBusy(true, "보관한 사진 불러오는 중…");
  try {
    items.push(...(await dbRead()));
    renderLibrary();
    if (items.length) await selectPhoto(items[0]);
  } catch {
    $("saveStatus").textContent =
      "기기 보관함을 사용할 수 없습니다. 완성본을 별도로 저장하세요.";
  } finally {
    setBusy(false);
  }
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js").catch(() => {});
})();

import "./styles.css";
import { DEFAULT_CLIP_MODEL, DEFAULT_DETECTOR_MODEL } from "./config";
import { allPhotos, clearPhotos, type PhotoRecord } from "./db";
import { filesFromDrop, filesFromInput, importFiles, type ImportProgress, type IncomingFile } from "./importer";
import { ModelClient } from "./models/client";
import type { FileProgress, LoadedModel } from "./models/protocol";
import { fmtBytes, fmtDate, fmtDateTime, h } from "./ui/dom";

// ---------------------------------------------------------------- state
const state = {
  photos: [] as PhotoRecord[],
  importing: null as ImportProgress | null,
  lastImport: null as ImportProgress | null,
  model: {
    files: [] as FileProgress[],
    loaded: [] as LoadedModel[],
    stage: "Starting model worker…",
    error: null as string | null,
    ready: false,
    isolated: false,
    threads: 1,
    startedAt: performance.now(),
    readyMs: 0,
  },
  hostsMain: {} as Record<string, number>,
  hostsWorker: {} as Record<string, number>,
  online: navigator.onLine,
  storage: null as { usage: number; quota: number; persisted: boolean } | null,
};

// ---------------------------------------------------------------- layout
const app = document.getElementById("app")!;
const badgeSlot = h("div");
const storageSlot = h("span", { class: "muted small" });
const modelSlot = h("section", { class: "panel" });
const importSlot = h("div");
const gridSlot = h("div");
const folderInput = h("input", { type: "file", multiple: true, hidden: true }) as HTMLInputElement;
folderInput.setAttribute("webkitdirectory", "");
const filesInput = h("input", {
  type: "file",
  multiple: true,
  hidden: true,
  accept: ".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif",
}) as HTMLInputElement;

app.append(
  h("header", { class: "top" }, h("h1", null, "Trace"), badgeSlot, h("div", { class: "spacer" }), storageSlot),
  modelSlot,
  h(
    "section",
    { class: "panel" },
    h(
      "div",
      { class: "row" },
      h("h2", null, "Photos"),
      h("div", { class: "spacer" }),
      h("button", { onclick: () => folderInput.click() }, "Choose folder"),
      h("button", { onclick: () => filesInput.click() }, "Choose files"),
      h("button", { class: "ghost", onclick: onClear }, "Clear library"),
    ),
    importSlot,
    gridSlot,
  ),
  folderInput,
  filesInput,
);

folderInput.onchange = () => folderInput.files && runImport(filesFromInput(folderInput.files), folderInput);
filesInput.onchange = () => filesInput.files && runImport(filesFromInput(filesInput.files), filesInput);

// Whole window is a drop target.
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) document.body.classList.remove("dragging");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  if (e.dataTransfer) runImport(await filesFromDrop(e.dataTransfer));
});

// ---------------------------------------------------------------- import
async function runImport(files: IncomingFile[], input?: HTMLInputElement) {
  if (state.importing) return;
  state.importing = { done: 0, total: 0, added: 0, duplicates: 0, skipped: 0, failed: [] };
  renderImport();
  const result = await importFiles(files, (p) => {
    state.importing = p;
    renderImport();
  });
  if (input) input.value = "";
  state.importing = null;
  state.lastImport = result;
  await refreshPhotos();
  renderImport();
  refreshStorage();
}

async function onClear() {
  if (!state.photos.length) return;
  if (!confirm(`Remove all ${state.photos.length} photos from this browser's library?`)) return;
  await clearPhotos();
  state.lastImport = null;
  await refreshPhotos();
  renderImport();
  refreshStorage();
}

async function refreshPhotos() {
  state.photos = await allPhotos();
  renderGrid();
}

// ---------------------------------------------------------------- models
const models = new ModelClient();
models.on((m) => {
  const s = state.model;
  switch (m.type) {
    case "progress":
      s.files = m.files;
      break;
    case "stage":
      s.stage = m.message;
      break;
    case "loaded":
      s.loaded = [...s.loaded.filter((x) => x.key !== m.model.key), m.model];
      break;
    case "ready":
      s.ready = true;
      s.isolated = m.crossOriginIsolated;
      s.threads = m.threads;
      s.readyMs = performance.now() - s.startedAt;
      s.stage = "Models ready";
      break;
    case "error":
      s.error = m.message;
      break;
    case "net":
      state.hostsWorker = m.hosts;
      renderBadge();
      return;
  }
  renderModels();
});
function loadModels() {
  Object.assign(state.model, { error: null, ready: false, loaded: [], stage: "Loading models…", startedAt: performance.now() });
  renderModels();
  models.load({ detector: DEFAULT_DETECTOR_MODEL, clip: DEFAULT_CLIP_MODEL, offline: !navigator.onLine });
}
loadModels();

// ---------------------------------------------------------------- network audit
const pageOrigin = location.host;
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const host = new URL(e.name, location.href).host;
      state.hostsMain[host] = (state.hostsMain[host] ?? 0) + 1;
    }
    renderBadge();
  }).observe({ type: "resource", buffered: true });
} catch {
  /* not supported */
}
window.addEventListener("online", () => ((state.online = true), renderBadge()));
window.addEventListener("offline", () => ((state.online = false), renderBadge()));

function externalHosts(): [string, number][] {
  const all: Record<string, number> = {};
  for (const src of [state.hostsMain, state.hostsWorker])
    for (const [k, v] of Object.entries(src)) if (k !== pageOrigin) all[k] = (all[k] ?? 0) + v;
  return Object.entries(all).sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------- render
function renderBadge() {
  const ext = externalHosts();
  const details = h(
    "div",
    { class: "badge-pop" },
    h("p", null, "Photos are processed in this browser and stored in IndexedDB. Nothing is uploaded."),
    h(
      "p",
      null,
      "The page's Content-Security-Policy only allows connections to this origin and Hugging Face (one-time model download).",
    ),
    h("p", { class: "muted" }, "Hosts contacted this session (excluding this origin):"),
    ext.length
      ? h("ul", null, ext.map(([host, n]) => h("li", null, `${host} — ${n} request${n > 1 ? "s" : ""}`)))
      : h("p", null, "None."),
  );
  badgeSlot.replaceChildren(
    h(
      "details",
      { class: "badge" },
      h(
        "summary",
        null,
        h("span", { class: `dot ${state.online ? "" : "off"}` }),
        "Local only",
        state.online ? "" : h("span", { class: "muted" }, " · offline"),
      ),
      details,
    ),
  );
}

function renderModels() {
  const s = state.model;
  const files = s.files.filter((f) => f.total > 0 || f.status !== "done");
  const loaded = files.reduce((a, f) => a + f.loaded, 0);
  const total = files.reduce((a, f) => a + f.total, 0);
  const pct = total ? Math.round((loaded / total) * 100) : 0;
  const head = h(
    "div",
    { class: "row" },
    h("h2", null, "Models"),
    h("span", { class: s.error ? "err" : s.ready ? "ok" : "muted" }, s.error ? "Failed" : s.stage),
    h("div", { class: "spacer" }),
    total ? h("span", { class: "muted small" }, `${fmtBytes(loaded)} / ${fmtBytes(total)}`) : null,
  );
  const bar = !s.ready && total ? h("div", { class: "bar" }, h("div", { style: `width:${pct}%` })) : null;
  const loadedRows = s.loaded.length
    ? h(
        "table",
        { class: "tbl" },
        h("tr", null, h("th", null, "Role"), h("th", null, "Model"), h("th", null, "Device"), h("th", null, "Precision"), h("th", null, "Load")),
        s.loaded.map((m) =>
          h(
            "tr",
            null,
            h("td", null, { detector: "Detector", clipVision: "CLIP image", clipText: "CLIP text" }[m.key]),
            h("td", null, h("code", null, m.id)),
            h("td", null, m.device),
            h("td", null, m.dtype),
            h("td", null, `${(m.ms / 1000).toFixed(1)} s`),
          ),
        ),
      )
    : null;
  const fileRows = files.length
    ? h(
        "details",
        { open: !s.ready },
        h("summary", { class: "muted small" }, `${files.length} files`),
        h(
          "table",
          { class: "tbl small" },
          files.map((f) =>
            h(
              "tr",
              null,
              h("td", null, h("code", null, `${f.model}/${f.file}`)),
              h("td", { class: "num" }, f.total ? `${Math.round((f.loaded / f.total) * 100)}%` : f.status),
              h("td", { class: "num" }, fmtBytes(f.total)),
            ),
          ),
        ),
      )
    : null;
  const env = s.ready
    ? h(
        "p",
        { class: "muted small" },
        `Ready in ${(s.readyMs / 1000).toFixed(1)} s · WASM threads: ${s.threads}` +
          (s.isolated ? "" : " (page not cross-origin isolated, single-threaded)"),
      )
    : null;
  const errorBox = s.error
    ? h(
        "div",
        null,
        h("pre", { class: "err" }, s.error),
        h(
          "p",
          { class: "muted small" },
          navigator.onLine
            ? "Check that huggingface.co is reachable (first run only), then retry."
            : "You are offline and the models are not in this browser's cache yet. Connect once to download them.",
        ),
        h("button", { onclick: loadModels }, "Retry"),
      )
    : "";
  modelSlot.replaceChildren(head, bar ?? "", errorBox, loadedRows ?? "", fileRows ?? "", env ?? "");
}

function renderImport() {
  const p = state.importing ?? state.lastImport;
  if (!p) return importSlot.replaceChildren();
  const busy = !!state.importing;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  importSlot.replaceChildren(
    h(
      "div",
      { class: "import" },
      busy ? h("div", { class: "bar" }, h("div", { style: `width:${pct}%` })) : null,
      h(
        "p",
        { class: "small" },
        busy ? `Importing ${p.done}/${p.total}… ` : "Last import: ",
        `${p.added} added, ${p.duplicates} duplicate${p.duplicates === 1 ? "" : "s"} skipped`,
        p.skipped ? `, ${p.skipped} non-image file${p.skipped === 1 ? "" : "s"} ignored` : "",
        p.failed.length ? `, ${p.failed.length} failed` : "",
      ),
      p.failed.length
        ? h("ul", { class: "err small" }, p.failed.slice(0, 20).map((f) => h("li", null, `${f.name}: ${f.reason}`)))
        : null,
    ),
  );
}

let thumbUrls: string[] = [];
function renderGrid() {
  thumbUrls.forEach(URL.revokeObjectURL);
  thumbUrls = [];
  if (!state.photos.length) {
    gridSlot.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("p", null, "No photos yet."),
        h("p", { class: "muted" }, "Drop photos or a whole folder anywhere on this page (JPEG, PNG, WebP, HEIC)."),
      ),
    );
    return;
  }
  const exif = state.photos.filter((p) => p.dateSource === "exif").length;
  const first = state.photos[0].takenAt;
  const last = state.photos[state.photos.length - 1].takenAt;
  gridSlot.replaceChildren(
    h(
      "p",
      { class: "muted small" },
      `${state.photos.length} photos · ${fmtDate(first)} → ${fmtDate(last)} · ${exif} dated from EXIF, ${state.photos.length - exif} from file date`,
    ),
    h(
      "div",
      { class: "grid" },
      state.photos.map((p) => {
        const url = URL.createObjectURL(p.thumb);
        thumbUrls.push(url);
        return h(
          "figure",
          { class: "ph", title: `${p.relPath}\n${p.width}×${p.height} stored · ${fmtBytes(p.size)} original` },
          h("img", { src: url, loading: "lazy", alt: p.name }),
          h(
            "figcaption",
            null,
            h("span", { class: "name" }, p.name),
            h(
              "span",
              { class: "date" },
              fmtDateTime(p.takenAt),
              h("span", { class: `chip ${p.dateSource}` }, p.dateSource === "exif" ? "EXIF" : "file date"),
            ),
          ),
        );
      }),
    ),
  );
}

async function refreshStorage() {
  if (!navigator.storage?.estimate) return;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  state.storage = { usage, quota, persisted };
  storageSlot.textContent = `Stored locally: ${fmtBytes(usage)}${persisted ? " (persistent)" : ""}`;
}

// ---------------------------------------------------------------- boot
renderBadge();
renderModels();
renderImport();
await refreshPhotos();
// Ask the browser not to evict models and photos under storage pressure.
await navigator.storage?.persist?.().catch(() => false);
refreshStorage();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

/// <reference lib="webworker" />
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  env,
  pipeline,
  RawImage,
} from "@huggingface/transformers";
import { PERSON_QUERY, postProcess, promptFor, type RawDetection } from "../detect-post";
import type { DetectRequest, FileProgress, FromWorker, LoadedModel, ModelConfig, ModelKey, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;
const post = (m: FromWorker) => self.postMessage(m);

// ---- Runtime setup: serve ONNX Runtime WASM from this origin, never a CDN.
const ort = env.backends.onnx;
if (ort.wasm) {
  const isOldSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) && !("gpu" in navigator);
  const flavour = isOldSafari ? "" : ".asyncify";
  const base = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.origin).href;
  ort.wasm.wasmPaths = {
    mjs: `${base}ort-wasm-simd-threaded${flavour}.mjs`,
    wasm: `${base}ort-wasm-simd-threaded${flavour}.wasm`,
  };
  ort.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
}
env.allowLocalModels = false; // only the HF cache / hub, no /models/ lookups on this origin
env.useBrowserCache = true;

// ---- Network audit: report every host this worker contacts.
const hosts: Record<string, number> = {};
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const h = new URL(e.name, self.location.href).host;
      hosts[h] = (hosts[h] ?? 0) + 1;
    }
    post({ type: "net", hosts: { ...hosts } });
  }).observe({ type: "resource", buffered: true });
} catch {
  /* PerformanceObserver unavailable in this worker */
}

// ---- Download progress, aggregated per file and throttled.
const files = new Map<string, FileProgress>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function onProgress(info: unknown) {
  const i = info as { status: string; name?: string; file?: string; loaded?: number; total?: number };
  if (!i.file || !i.name) return;
  if (!["initiate", "download", "progress", "done"].includes(i.status)) return;
  const key = `${i.name}/${i.file}`;
  const prev = files.get(key);
  files.set(key, {
    model: i.name,
    file: i.file,
    loaded: i.loaded ?? prev?.loaded ?? 0,
    total: i.total ?? prev?.total ?? 0,
    status: i.status as FileProgress["status"],
  });
  if (i.status === "done" && prev && prev.total > 0) files.get(key)!.loaded = prev.total;
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    post({ type: "progress", files: [...files.values()] });
  }, 100);
}

// ---- Device / precision fallback chain.
type Attempt = { device: "webgpu" | "wasm"; dtype: "fp16" | "fp32" | "q8" };

async function attempts(wasmOnly = false): Promise<Attempt[]> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  let hasGpu = false;
  try {
    hasGpu = !!(gpu && (await gpu.requestAdapter()));
  } catch {
    hasGpu = false;
  }
  const wasm: Attempt[] = [{ device: "wasm", dtype: "q8" }, { device: "wasm", dtype: "fp32" }];
  if (wasmOnly) return wasm;
  // fp16 halves the download; not every repo ships it, hence the fallback.
  return hasGpu ? [{ device: "webgpu", dtype: "fp16" }, { device: "webgpu", dtype: "fp32" }, ...wasm] : wasm;
}

async function loadWithFallback<T>(
  key: ModelKey,
  id: string,
  load: (a: Attempt) => Promise<T>,
  wasmOnly = false,
): Promise<{ value: T; info: LoadedModel }> {
  const errors: string[] = [];
  for (const a of await attempts(wasmOnly)) {
    const t0 = performance.now();
    try {
      post({ type: "stage", message: `Loading ${id} (${a.device}, ${a.dtype})…` });
      const value = await load(a);
      const info: LoadedModel = { key, id, device: a.device, dtype: a.dtype, ms: performance.now() - t0 };
      post({ type: "loaded", model: info });
      return { value, info };
    } catch (err) {
      errors.push(`${a.device}/${a.dtype}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Could not load ${id}.\n${errors.join("\n")}`);
}

// Loaded models, used by detection and embeddings in later steps.
type Detector = (
  image: RawImage,
  labels: string[],
  opts: { threshold: number; percentage: boolean },
) => Promise<RawDetection[]>;

const models: {
  detector?: Detector;
  detectorInfo?: LoadedModel;
  detectorId?: string;
  clipVision?: unknown;
  clipText?: unknown;
  clipProcessor?: unknown;
  clipTokenizer?: unknown;
} = {};

async function load(cfg: ModelConfig) {
  env.allowRemoteModels = !cfg.offline;
  const common = { progress_callback: onProgress };
  const loaded: LoadedModel[] = [];

  const det = await loadWithFallback("detector", cfg.detector, (a) =>
    pipeline("zero-shot-object-detection", cfg.detector, { ...common, device: a.device, dtype: a.dtype }),
  );
  models.detector = det.value as unknown as Detector;
  models.detectorInfo = det.info;
  models.detectorId = cfg.detector;
  loaded.push(det.info);

  models.clipProcessor = await AutoProcessor.from_pretrained(cfg.clip, common);
  models.clipTokenizer = await AutoTokenizer.from_pretrained(cfg.clip, common);
  const vis = await loadWithFallback("clipVision", cfg.clip, (a) =>
    CLIPVisionModelWithProjection.from_pretrained(cfg.clip, { ...common, device: a.device, dtype: a.dtype }),
  );
  models.clipVision = vis.value;
  loaded.push(vis.info);
  const txt = await loadWithFallback("clipText", cfg.clip, (a) =>
    CLIPTextModelWithProjection.from_pretrained(cfg.clip, { ...common, device: a.device, dtype: a.dtype }),
  );
  models.clipText = txt.value;
  loaded.push(txt.info);

  post({ type: "progress", files: [...files.values()] });
  post({
    type: "ready",
    models: loaded,
    crossOriginIsolated: self.crossOriginIsolated,
    threads: ort.wasm?.numThreads ?? 1,
  });
}

async function runDetector(image: RawImage, queries: string[], floor: number): Promise<RawDetection[]> {
  if (!models.detector) throw new Error("Detector not loaded yet");
  return models.detector(image, queries, { threshold: floor, percentage: false });
}

async function detect(req: DetectRequest) {
  const image = await RawImage.fromBlob(req.image);
  // Person is queried only so that crops that are mostly a person can be
  // discarded below; person boxes never leave this function.
  const queries = [...req.vocab.map(promptFor), PERSON_QUERY];
  const floor = Math.min(req.floor, 0.1);
  const t0 = performance.now();
  let raw: RawDetection[];
  try {
    raw = await runDetector(image, queries, floor);
  } catch (err) {
    // Some GPUs load the model but fail at inference: fall back to WASM once.
    if (models.detectorInfo?.device !== "webgpu" || !models.detectorId) throw err;
    const id = models.detectorId;
    const det = await loadWithFallback(
      "detector",
      id,
      (a) => pipeline("zero-shot-object-detection", id, { progress_callback: onProgress, device: a.device, dtype: a.dtype }),
      true,
    );
    models.detector = det.value as unknown as Detector;
    models.detectorInfo = det.info;
    raw = await runDetector(image, queries, floor);
  }
  const ms = performance.now() - t0;
  const detections = postProcess(raw, req.vocab, { threshold: req.floor, width: image.width, height: image.height });
  post({
    type: "detected",
    reqId: req.reqId,
    detections,
    width: image.width,
    height: image.height,
    ms,
    device: `${models.detectorInfo?.device}/${models.detectorInfo?.dtype}`,
  });
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    if (msg.type === "load") await load(msg.config);
    else if (msg.type === "detect") await detect(msg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (msg.type === "detect") post({ type: "detectError", reqId: msg.reqId, message });
    else post({ type: "error", message });
  }
};

import type { DetectResult, FromWorker, ModelConfig } from "./protocol";

type Listener = (m: FromWorker) => void;

/** Thin wrapper around the single model worker. */
export class ModelClient {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "trace-models" });
  private listeners = new Set<Listener>();
  private pending = new Map<number, { resolve: (r: DetectResult) => void; reject: (e: Error) => void }>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === "detected" || m.type === "detectError") {
        const p = this.pending.get(m.reqId);
        this.pending.delete(m.reqId);
        if (m.type === "detected") p?.resolve(m);
        else p?.reject(new Error(m.message));
      }
      this.listeners.forEach((l) => l(m));
    };
    this.worker.onerror = (e) =>
      this.listeners.forEach((l) => l({ type: "error", message: e.message || "Worker failed to start" }));
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  load(config: ModelConfig): void {
    this.worker.postMessage({ type: "load", config });
  }

  /** Runs detection on one image. Requests are processed one at a time by the worker. */
  detect(image: Blob, vocab: string[], floor: number): Promise<DetectResult> {
    const reqId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.worker.postMessage({ type: "detect", reqId, image, vocab, floor });
    });
  }
}

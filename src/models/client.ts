import type { FromWorker, ModelConfig } from "./protocol";

type Listener = (m: FromWorker) => void;

/** Thin wrapper around the single model worker. */
export class ModelClient {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "trace-models" });
  private listeners = new Set<Listener>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.listeners.forEach((l) => l(e.data));
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
}

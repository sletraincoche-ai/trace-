// Messages between the UI thread and the model worker.

export interface ModelConfig {
  detector: string;
  clip: string;
  /** When true, Transformers.js must not touch the network (cache only). */
  offline: boolean;
}

export type ModelKey = "detector" | "clipVision" | "clipText";

export type ToWorker = { type: "load"; config: ModelConfig };

export interface FileProgress {
  model: string;
  file: string;
  loaded: number;
  total: number;
  status: "initiate" | "download" | "progress" | "done";
}

export interface LoadedModel {
  key: ModelKey;
  id: string;
  device: "webgpu" | "wasm";
  dtype: string;
  ms: number;
}

export type FromWorker =
  | { type: "progress"; files: FileProgress[] }
  | { type: "stage"; message: string }
  | { type: "loaded"; model: LoadedModel }
  | { type: "ready"; models: LoadedModel[]; crossOriginIsolated: boolean; threads: number }
  | { type: "error"; message: string }
  | { type: "net"; hosts: Record<string, number> };

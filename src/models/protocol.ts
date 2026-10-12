// Messages between the UI thread and the model worker.
import type { Detection } from "../detect-post";

export interface ModelConfig {
  detector: string;
  clip: string;
  /** When true, Transformers.js must not touch the network (cache only). */
  offline: boolean;
}

export type ModelKey = "detector" | "clipVision" | "clipText";

export interface DetectRequest {
  type: "detect";
  reqId: number;
  image: Blob;
  vocab: string[];
  /** Lowest score returned; the UI filters further without re-running. */
  floor: number;
}

export type ToWorker = { type: "load"; config: ModelConfig } | DetectRequest;

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

export interface DetectResult {
  detections: Detection[];
  width: number;
  height: number;
  ms: number;
  device: string;
}

export type FromWorker =
  | { type: "progress"; files: FileProgress[] }
  | { type: "stage"; message: string }
  | { type: "loaded"; model: LoadedModel }
  | { type: "ready"; models: LoadedModel[]; crossOriginIsolated: boolean; threads: number }
  | { type: "error"; message: string }
  | { type: "net"; hosts: Record<string, number> }
  | ({ type: "detected"; reqId: number } & DetectResult)
  | { type: "detectError"; reqId: number; message: string };

// Defaults. Everything here is editable in the app and persisted locally.

/** Zero-shot detector (Transformers.js ONNX port of google/owlvit-base-patch32). */
export const DEFAULT_DETECTOR_MODEL = "Xenova/owlvit-base-patch32";
/** CLIP for crop/text embeddings (ONNX port of openai/clip-vit-base-patch32). */
export const DEFAULT_CLIP_MODEL = "Xenova/clip-vit-base-patch32";

export const DEFAULT_VOCAB: readonly string[] = [
  "armchair", "sofa", "chair", "table", "bed", "bookshelf", "lamp", "TV",
  "laptop", "tablet", "phone", "bicycle", "guitar", "piano", "jewelry", "watch",
  "handbag", "suitcase", "painting", "rug", "fridge", "washing machine",
  "coffee machine", "camera", "headphones", "speakers", "vase", "mirror",
];

export const DEFAULT_SCORE_THRESHOLD = 0.25;
export const DEFAULT_SIMILARITY = 0.88;

/** Long edge of the working copy stored in IndexedDB (originals are not kept). */
export const WORKING_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 320;

export const ACCEPTED_EXT = ["jpg", "jpeg", "png", "webp", "heic", "heif"] as const;

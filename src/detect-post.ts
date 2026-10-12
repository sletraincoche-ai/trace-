// Pure post-processing of raw zero-shot detections. DOM-free and unit-tested.

export interface Box {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface Detection {
  label: string;
  score: number;
  /** Pixel coordinates in the stored working image. */
  box: Box;
}

/** Internal query used only to discard crops that are mostly a person. Never stored. */
export const PERSON_QUERY = "a photo of a person";

/** OWL-ViT is trained on caption-like queries; "a photo of a X" works better than "X". */
export function promptFor(label: string): string {
  return `a photo of a ${label}`;
}

export function area(b: Box): number {
  return Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);
}

export function intersection(a: Box, b: Box): number {
  return area({
    xmin: Math.max(a.xmin, b.xmin),
    ymin: Math.max(a.ymin, b.ymin),
    xmax: Math.min(a.xmax, b.xmax),
    ymax: Math.min(a.ymax, b.ymax),
  });
}

export function iou(a: Box, b: Box): number {
  const i = intersection(a, b);
  const u = area(a) + area(b) - i;
  return u > 0 ? i / u : 0;
}

/** Clamp to the image and drop degenerate boxes (OWL-ViT can return -1 or w+1). */
export function clampBox(b: Box, w: number, h: number): Box {
  return {
    xmin: Math.max(0, Math.min(w, b.xmin)),
    ymin: Math.max(0, Math.min(h, b.ymin)),
    xmax: Math.max(0, Math.min(w, b.xmax)),
    ymax: Math.max(0, Math.min(h, b.ymax)),
  };
}

/**
 * Greedy non-maximum suppression. Same label: suppress above `sameLabelIou`.
 * Different labels (e.g. "chair" vs "armchair" on one object): suppress only
 * above the stricter `crossLabelIou`, keeping the higher score.
 */
export function nms(dets: Detection[], sameLabelIou = 0.5, crossLabelIou = 0.85): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of sorted) {
    const clash = kept.some((k) => iou(k.box, d.box) > (k.label === d.label ? sameLabelIou : crossLabelIou));
    if (!clash) kept.push(d);
  }
  return kept;
}

/** Drops detections whose box lies mostly (>= `maxCover`) inside a person box. */
export function dropMostlyPerson(dets: Detection[], persons: Box[], maxCover = 0.5): Detection[] {
  return dets.filter((d) => {
    const a = area(d.box);
    return a > 0 && !persons.some((p) => intersection(d.box, p) / a >= maxCover);
  });
}

export interface RawDetection {
  label: string;
  score: number;
  box: Box;
}

/**
 * Full pipeline from raw model output (labels are the prompts) to stored
 * detections: map prompts back to vocabulary labels, split out person boxes,
 * clamp, filter tiny boxes, threshold, NMS, then drop mostly-person crops.
 */
export function postProcess(
  raw: RawDetection[],
  vocab: string[],
  opts: { threshold: number; width: number; height: number; minAreaFrac?: number },
): Detection[] {
  const byPrompt = new Map(vocab.map((l) => [promptFor(l), l]));
  const minArea = (opts.minAreaFrac ?? 0.0015) * opts.width * opts.height;
  const persons: Box[] = [];
  const items: Detection[] = [];
  for (const r of raw) {
    const box = clampBox(r.box, opts.width, opts.height);
    if (r.label === PERSON_QUERY) {
      persons.push(box);
      continue;
    }
    const label = byPrompt.get(r.label);
    if (!label || r.score < opts.threshold || area(box) < minArea) continue;
    items.push({ label, score: r.score, box });
  }
  return dropMostlyPerson(nms(items), persons);
}

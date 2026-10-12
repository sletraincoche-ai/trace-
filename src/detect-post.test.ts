import { describe, expect, it } from "vitest";
import { dropMostlyPerson, iou, nms, PERSON_QUERY, postProcess, promptFor, type Detection } from "./detect-post";

const box = (xmin: number, ymin: number, xmax: number, ymax: number) => ({ xmin, ymin, xmax, ymax });
const det = (label: string, score: number, b = box(0, 0, 100, 100)): Detection => ({ label, score, box: b });

describe("detection post-processing", () => {
  it("computes IoU", () => {
    expect(iou(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(1);
    expect(iou(box(0, 0, 10, 10), box(20, 20, 30, 30))).toBe(0);
    expect(iou(box(0, 0, 10, 10), box(5, 0, 15, 10))).toBeCloseTo(1 / 3);
  });

  it("suppresses overlapping boxes of the same label, keeping the best", () => {
    const out = nms([det("chair", 0.3), det("chair", 0.6, box(5, 5, 105, 105)), det("chair", 0.4, box(300, 300, 400, 400))]);
    expect(out.map((d) => d.score)).toEqual([0.6, 0.4]);
  });

  it("keeps different labels unless they are near-identical boxes", () => {
    expect(nms([det("chair", 0.5), det("table", 0.4, box(30, 30, 130, 130))])).toHaveLength(2);
    expect(nms([det("chair", 0.5), det("armchair", 0.4, box(1, 1, 100, 100))]).map((d) => d.label)).toEqual(["chair"]);
  });

  it("drops crops that are mostly a person, keeps others", () => {
    const person = box(0, 0, 100, 200);
    const watch = det("watch", 0.5, box(40, 100, 60, 120)); // fully inside the person
    const sofa = det("sofa", 0.5, box(50, 150, 400, 300)); // person sitting on it, small overlap
    expect(dropMostlyPerson([watch, sofa], [person]).map((d) => d.label)).toEqual(["sofa"]);
  });

  it("maps prompts back to labels, thresholds, clamps and never returns person", () => {
    const raw = [
      { label: promptFor("lamp"), score: 0.4, box: box(-5, -1, 50, 60) },
      { label: promptFor("vase"), score: 0.1, box: box(100, 100, 150, 150) },
      { label: PERSON_QUERY, score: 0.9, box: box(200, 0, 300, 300) },
      { label: promptFor("TV"), score: 0.5, box: box(210, 10, 290, 100) },
      { label: "a photo of a toaster", score: 0.9, box: box(0, 0, 50, 50) },
    ];
    const out = postProcess(raw, ["lamp", "vase", "TV"], { threshold: 0.25, width: 320, height: 240 });
    expect(out).toEqual([{ label: "lamp", score: 0.4, box: box(0, 0, 50, 60) }]);
  });

  it("drops boxes too small to be a useful crop", () => {
    const raw = [{ label: promptFor("watch"), score: 0.9, box: box(0, 0, 3, 3) }];
    expect(postProcess(raw, ["watch"], { threshold: 0.25, width: 1000, height: 1000 })).toEqual([]);
  });
});

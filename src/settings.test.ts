import { describe, expect, it } from "vitest";
import { parseVocab } from "./settings";

describe("parseVocab", () => {
  it("splits, trims, dedupes case-insensitively", () => {
    expect(parseVocab(" sofa \nchair, Chair\n\n  coffee   machine ")).toEqual(["sofa", "chair", "coffee machine"]);
  });
  it("refuses person-like labels", () => {
    expect(parseVocab("person\nPeople\nface\nlamp")).toEqual(["lamp"]);
  });
});

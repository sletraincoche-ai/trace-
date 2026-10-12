import { describe, expect, it } from "vitest";
import { fitWithin, isAcceptedImage, isHeic, photoKey, pickCaptureDate } from "./dedupe";

describe("import helpers", () => {
  it("builds the dedupe key from name, size and date", () => {
    expect(photoKey("a.jpg", 10, 5)).toBe("a.jpg|10|5");
    expect(photoKey("a.jpg", 10, 5)).not.toBe(photoKey("a.jpg", 10, 6));
  });

  it("accepts the four formats, case-insensitively", () => {
    for (const n of ["x.JPG", "x.jpeg", "x.png", "x.webp", "x.HEIC", "x.heif"]) {
      expect(isAcceptedImage(n)).toBe(true);
    }
    expect(isAcceptedImage("x.gif")).toBe(false);
    expect(isAcceptedImage("x.txt")).toBe(false);
    expect(isAcceptedImage("noext", "image/heic")).toBe(true);
    expect(isHeic("IMG_1.HEIC")).toBe(true);
    expect(isHeic("a.jpg")).toBe(false);
  });

  it("prefers a plausible EXIF date and falls back to lastModified", () => {
    const exif = new Date(2021, 4, 3, 10, 0, 0);
    expect(pickCaptureDate(exif, 123)).toEqual({ takenAt: exif.getTime(), source: "exif" });
    expect(pickCaptureDate(undefined, 123)).toEqual({ takenAt: 123, source: "file" });
    expect(pickCaptureDate(new Date("invalid"), 123).source).toBe("file");
    expect(pickCaptureDate(new Date(0), 123).source).toBe("file");
  });

  it("downscales preserving aspect and never upscales", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(800, 600, 1600)).toEqual({ w: 800, h: 600 });
  });
});

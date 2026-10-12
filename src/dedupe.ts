// Pure helpers for import; kept DOM-free so they are unit-testable.
import { ACCEPTED_EXT } from "./config";

export function photoKey(name: string, size: number, takenAt: number): string {
  return `${name}|${size}|${takenAt}`;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function isAcceptedImage(name: string, mime = ""): boolean {
  if ((ACCEPTED_EXT as readonly string[]).includes(extOf(name))) return true;
  return /^image\/(jpeg|png|webp|heic|heif)$/.test(mime);
}

export function isHeic(name: string, mime = ""): boolean {
  const e = extOf(name);
  return e === "heic" || e === "heif" || /^image\/hei[cf]$/.test(mime);
}

/** EXIF date if valid and plausible, else the file's lastModified. */
export function pickCaptureDate(
  exifDate: Date | undefined | null,
  lastModified: number,
): { takenAt: number; source: "exif" | "file" } {
  const t = exifDate instanceof Date ? exifDate.getTime() : NaN;
  // Cameras with an unset clock write 0000:00:00 or 1970 dates; treat as missing.
  if (Number.isFinite(t) && t > Date.UTC(1990, 0, 1) && t < Date.now() + 86_400_000) {
    return { takenAt: t, source: "exif" };
  }
  return { takenAt: lastModified, source: "file" };
}

export function fitWithin(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const s = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

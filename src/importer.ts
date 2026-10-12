import exifr from "exifr";
import { THUMB_MAX_EDGE, WORKING_MAX_EDGE } from "./config";
import { hasPhoto, putPhoto, type PhotoRecord } from "./db";
import { fitWithin, isAcceptedImage, isHeic, photoKey, pickCaptureDate } from "./dedupe";

export interface IncomingFile {
  file: File;
  relPath: string;
}

export interface ImportProgress {
  done: number;
  total: number;
  added: number;
  duplicates: number;
  skipped: number;
  failed: { name: string; reason: string }[];
}

/** Files from a drag-and-drop, recursing into dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<IncomingFile[]> {
  const entries = [...dt.items]
    .map((it) => (it.kind === "file" ? it.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return [...dt.files].map((file) => ({ file, relPath: file.name }));
  const out: IncomingFile[] = [];
  for (const e of entries) await walk(e, out);
  return out;
}

async function walk(entry: FileSystemEntry, out: IncomingFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file, relPath: entry.fullPath.replace(/^\//, "") });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns at most ~100 entries per call; loop until empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) break;
    for (const child of batch) await walk(child, out);
  }
}

export function filesFromInput(list: FileList): IncomingFile[] {
  return [...list].map((file) => ({ file, relPath: file.webkitRelativePath || file.name }));
}

async function readExifDate(file: File): Promise<Date | undefined> {
  try {
    const tags = (await exifr.parse(file, { pick: ["DateTimeOriginal", "CreateDate"] })) as
      | { DateTimeOriginal?: Date; CreateDate?: Date }
      | undefined;
    return tags?.DateTimeOriginal ?? tags?.CreateDate;
  } catch {
    return undefined;
  }
}

async function decode(file: File): Promise<ImageBitmap> {
  // Browsers apply EXIF orientation by default, so stored pixels are upright.
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (err) {
    if (!isHeic(file.name, file.type)) throw err;
  }
  // Most browsers (except Safari) cannot decode HEIC natively.
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  const jpeg = Array.isArray(out) ? out[0] : out;
  return createImageBitmap(jpeg, { imageOrientation: "from-image" });
}

async function resizeToJpeg(bmp: ImageBitmap, maxEdge: number, quality: number) {
  const { w, h } = fitWithin(bmp.width, bmp.height, maxEdge);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  return { blob: await canvas.convertToBlob({ type: "image/jpeg", quality }), w, h };
}

/**
 * Imports files into IndexedDB. Duplicates (same name + size + capture date,
 * within this batch or already stored) are skipped before any decoding.
 */
export async function importFiles(
  files: IncomingFile[],
  onProgress: (p: ImportProgress) => void,
  concurrency = 3,
): Promise<ImportProgress> {
  const images = files.filter((f) => isAcceptedImage(f.file.name, f.file.type));
  const p: ImportProgress = {
    done: 0,
    total: images.length,
    added: 0,
    duplicates: 0,
    skipped: files.length - images.length,
    failed: [],
  };
  onProgress({ ...p });
  const seen = new Set<string>();
  let next = 0;

  const one = async ({ file, relPath }: IncomingFile) => {
    const { takenAt, source } = pickCaptureDate(await readExifDate(file), file.lastModified);
    const id = photoKey(file.name, file.size, takenAt);
    // Mark as seen before awaiting so parallel workers cannot both import it.
    if (seen.has(id)) {
      p.duplicates++;
      return;
    }
    seen.add(id);
    if (await hasPhoto(id)) {
      p.duplicates++;
      return;
    }
    const bmp = await decode(file);
    try {
      const work = await resizeToJpeg(bmp, WORKING_MAX_EDGE, 0.88);
      const thumb = await resizeToJpeg(bmp, THUMB_MAX_EDGE, 0.8);
      const rec: PhotoRecord = {
        id,
        name: file.name,
        relPath,
        size: file.size,
        mime: file.type || "image/" + file.name.split(".").pop(),
        lastModified: file.lastModified,
        takenAt,
        dateSource: source,
        width: work.w,
        height: work.h,
        image: work.blob,
        thumb: thumb.blob,
        importedAt: Date.now(),
      };
      await putPhoto(rec);
      p.added++;
    } finally {
      bmp.close();
    }
  };

  const worker = async () => {
    while (next < images.length) {
      const f = images[next++];
      try {
        await one(f);
      } catch (err) {
        p.failed.push({ name: f.relPath, reason: err instanceof Error ? err.message : String(err) });
      }
      p.done++;
      onProgress({ ...p, failed: [...p.failed] });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, images.length) }, worker));
  return p;
}

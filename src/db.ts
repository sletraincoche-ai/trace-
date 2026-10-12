import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type DateSource = "exif" | "file";

export interface PhotoRecord {
  /** Dedupe key: name|size|takenAt. */
  id: string;
  name: string;
  relPath: string;
  size: number;
  mime: string;
  lastModified: number;
  takenAt: number;
  dateSource: DateSource;
  /** Dimensions of the stored working copy (EXIF orientation already applied). */
  width: number;
  height: number;
  image: Blob;
  thumb: Blob;
  importedAt: number;
}

interface TraceDB extends DBSchema {
  photos: { key: string; value: PhotoRecord; indexes: { takenAt: number } };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<TraceDB>> | null = null;

export function db(): Promise<IDBPDatabase<TraceDB>> {
  dbp ??= openDB<TraceDB>("trace", 1, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        const photos = d.createObjectStore("photos", { keyPath: "id" });
        photos.createIndex("takenAt", "takenAt");
        d.createObjectStore("kv");
      }
    },
  });
  return dbp;
}

export async function allPhotos(): Promise<PhotoRecord[]> {
  return (await db()).getAllFromIndex("photos", "takenAt");
}

export async function hasPhoto(id: string): Promise<boolean> {
  return (await (await db()).getKey("photos", id)) !== undefined;
}

export async function putPhoto(p: PhotoRecord): Promise<void> {
  await (await db()).put("photos", p);
}

export async function clearPhotos(): Promise<void> {
  await (await db()).clear("photos");
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get("kv", key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put("kv", value, key);
}

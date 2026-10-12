import { DEFAULT_SCORE_THRESHOLD, DEFAULT_SIMILARITY, DEFAULT_VOCAB } from "./config";
import { kvGet, kvSet } from "./db";

export interface Settings {
  vocab: string[];
  threshold: number;
  similarity: number;
}

export const settings: Settings = {
  vocab: [...DEFAULT_VOCAB],
  threshold: DEFAULT_SCORE_THRESHOLD,
  similarity: DEFAULT_SIMILARITY,
};

export async function loadSettings(): Promise<Settings> {
  const saved = await kvGet<Partial<Settings>>("settings");
  if (saved) Object.assign(settings, saved);
  return settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  Object.assign(settings, patch);
  await kvSet("settings", { ...settings });
}

/** Parses the vocabulary textarea: one label per line (commas also accepted), deduped. */
export function parseVocab(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const label = raw.trim().replace(/\s+/g, " ");
    // "person" is never an inventory label (privacy rule).
    if (!label || /^(person|people|man|woman|face|human)s?$/i.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

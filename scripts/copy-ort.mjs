// Copies the ONNX Runtime Web WASM runtime that Transformers.js uses into
// public/ort/ so it is served from this origin (no CDN fetch, works offline).
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "node_modules/@huggingface/transformers/package.json"));
// onnxruntime-web does not export ./package.json, so locate its folder via the
// same lookup paths Node would use from inside @huggingface/transformers.
const ortDir = (require.resolve.paths("onnxruntime-web") ?? [])
  .map((p) => join(p, "onnxruntime-web"))
  .find((p) => existsSync(join(p, "package.json")));
if (!ortDir) throw new Error("onnxruntime-web not found; run npm install");
const src = join(ortDir, "dist");
const out = join(root, "public/ort");
mkdirSync(out, { recursive: true });

const wanted = readdirSync(src).filter((f) => /^ort-wasm-simd-threaded(\.asyncify|\.jsep)?\.(mjs|wasm)$/.test(f));
if (wanted.length === 0) throw new Error(`No ORT wasm files found in ${src}`);
for (const f of wanted) copyFileSync(join(src, f), join(out, f));
const { version } = JSON.parse(readFileSync(join(ortDir, "package.json"), "utf8"));
console.log(`[trace] copied ${wanted.length} onnxruntime-web ${version} files to public/ort/`);
if (!existsSync(join(out, "ort-wasm-simd-threaded.asyncify.wasm"))) {
  console.warn("[trace] asyncify build missing; worker will fall back to the plain build");
}

import { defineConfig } from "vite";

// Privacy guard: the browser itself refuses any connection that is not this
// origin or the Hugging Face model hosts (used once, to download the models).
// 'unsafe-eval' is needed only by heic2any's embedded libheif worker.
const csp = (dev: boolean) =>
  [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' blob:",
    "worker-src 'self' blob:",
    `connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co${dev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    "img-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

// Cross-origin isolation enables multi-threaded WASM (SharedArrayBuffer).
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  server: { headers: { ...isolation, "Content-Security-Policy": csp(true) } },
  preview: { headers: { ...isolation, "Content-Security-Policy": csp(false) } },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
});

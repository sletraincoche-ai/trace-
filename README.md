# Trace (prototype)

Personal test prototype: a local-only web app that scans
your own photos and builds a home inventory.

```sh
cd trace-
npm install      # also copies the ONNX Runtime WASM into public/ort/
npm run dev      # http://localhost:5173
npm test         # unit tests for pure logic
```

Privacy: photos never leave the browser (IndexedDB). The only network traffic is
the one-time model download from Hugging Face, enforced by the
Content-Security-Policy in `vite.config.ts`. No face detection or recognition.

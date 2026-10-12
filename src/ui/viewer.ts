import type { PhotoRecord } from "../db";
import type { Detection } from "../detect-post";
import type { DetectResult } from "../models/protocol";
import { settings } from "../settings";
import { fmtDateTime, frag, h } from "./dom";

const SVG = "http://www.w3.org/2000/svg";

export interface ViewerDeps {
  photos: () => PhotoRecord[];
  modelsReady: () => boolean;
  detect: (photo: PhotoRecord) => Promise<DetectResult>;
  cached: (photo: PhotoRecord) => DetectResult | undefined;
  onThreshold: (t: number) => void;
}

export function labelColor(label: string): string {
  // Position in the vocabulary, spaced by the golden angle: neighbours differ a lot.
  const i = settings.vocab.indexOf(label);
  if (i >= 0) return `hsl(${Math.round((i * 137.508 + 20) % 360)} 75% 62%)`;
  let hash = 0x811c9dc5;
  for (const c of label) hash = Math.imul(hash ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return `hsl(${Math.round((hash * 137.508) % 360)} 75% 62%)`;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Full-screen photo viewer that runs detection and draws the boxes. */
export function openViewer(startIndex: number, deps: ViewerDeps): void {
  let index = startIndex;
  let url = "";
  let result: DetectResult | undefined;
  let status = "";
  let busy = false;
  let hover = -1;

  const stage = h("div", { class: "stage" });
  const side = h("aside", { class: "side" });
  const title = h("div", { class: "vtitle" });
  const modal = h(
    "div",
    { class: "modal", onclick: (e: Event) => e.target === modal && close() },
    h(
      "div",
      { class: "viewer" },
      h(
        "header",
        { class: "row" },
        h("button", { class: "ghost", title: "Previous (←)", onclick: () => go(-1) }, "←"),
        h("button", { class: "ghost", title: "Next (→)", onclick: () => go(1) }, "→"),
        title,
        h("div", { class: "spacer" }),
        h("button", { class: "ghost", title: "Close (Esc)", onclick: () => close() }, "✕"),
      ),
      h("div", { class: "vbody" }, stage, side),
    ),
  );

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
  };
  document.addEventListener("keydown", onKey);
  document.body.append(modal);

  function close() {
    document.removeEventListener("keydown", onKey);
    if (url) URL.revokeObjectURL(url);
    modal.remove();
  }

  function go(delta: number) {
    const n = deps.photos().length;
    if (!n) return;
    index = (index + delta + n) % n;
    show();
  }

  function visible(): Detection[] {
    return (result?.detections ?? []).filter((d) => d.score >= settings.threshold);
  }

  async function runDetect(force = false) {
    const photo = deps.photos()[index];
    if (!photo || busy) return;
    const cached = deps.cached(photo);
    if (cached && !force) {
      result = cached;
      status = "";
      return render();
    }
    if (!deps.modelsReady()) {
      status = "Models are not ready yet (see the Models panel). Press Detect once they are.";
      return render();
    }
    busy = true;
    status = "Detecting…";
    render();
    try {
      const r = await deps.detect(photo);
      if (deps.photos()[index]?.id === photo.id) result = r;
      status = "";
    } catch (err) {
      status = `Detection failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      busy = false;
      render();
    }
  }

  function show() {
    const photo = deps.photos()[index];
    if (!photo) return close();
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(photo.image);
    result = deps.cached(photo);
    status = "";
    hover = -1;
    render();
    if (!result) void runDetect();
  }

  function renderStage(photo: PhotoRecord, dets: Detection[]) {
    const svg = svgEl("svg", { viewBox: `0 0 ${photo.width} ${photo.height}`, class: "boxes" });
    const fs = Math.max(12, Math.round(Math.max(photo.width, photo.height) / 55));
    dets.forEach((d, i) => {
      const c = labelColor(d.label);
      const { xmin, ymin, xmax, ymax } = d.box;
      const g = svgEl("g", { class: hover === -1 || hover === i ? "" : "dim" });
      g.append(
        svgEl("rect", {
          x: xmin, y: ymin, width: xmax - xmin, height: ymax - ymin,
          fill: "none", stroke: c, "stroke-width": 2, "vector-effect": "non-scaling-stroke",
        }),
      );
      const text = `${d.label} ${Math.round(d.score * 100)}%`;
      const ty = ymin > fs * 1.4 ? ymin - fs * 0.35 : ymin + fs * 1.1;
      g.append(svgEl("rect", { x: xmin, y: ty - fs, width: text.length * fs * 0.58 + fs * 0.4, height: fs * 1.25, fill: c }));
      const t = svgEl("text", { x: xmin + fs * 0.2, y: ty, "font-size": fs, fill: "#0e0f11" });
      t.textContent = text;
      g.append(t);
      svg.append(g);
    });
    stage.replaceChildren(
      h("div", { class: "frame", style: `aspect-ratio:${photo.width}/${photo.height}` }, h("img", { src: url, alt: photo.name }), svg),
    );
  }

  function render() {
    const photo = deps.photos()[index];
    if (!photo) return;
    const dets = visible();
    title.replaceChildren(
      h("strong", null, photo.name),
      h("span", { class: "muted small" }, ` ${fmtDateTime(photo.takenAt)} · ${photo.dateSource === "exif" ? "EXIF date" : "file date"} · ${index + 1}/${deps.photos().length}`),
    );
    renderStage(photo, dets);

    const slider = h("input", {
      type: "range", min: 0.05, max: 0.9, step: 0.01, value: settings.threshold,
      oninput: (e: Event) => {
        deps.onThreshold(Number((e.target as HTMLInputElement).value));
        render();
      },
    });
    const hidden = (result?.detections.length ?? 0) - dets.length;
    side.replaceChildren(
      frag(
      h("label", { class: "small" }, `Score threshold: ${settings.threshold.toFixed(2)}`, slider),
      h(
        "div",
        { class: "row" },
        h("button", { disabled: busy || !deps.modelsReady(), onclick: () => runDetect(true) }, result ? "Run again" : "Detect"),
        busy ? h("span", { class: "muted small" }, "Detecting…") : null,
      ),
      status ? h("p", { class: status.startsWith("Detection failed") ? "err small" : "muted small" }, status) : null,
      result
        ? h(
            "p",
            { class: "muted small" },
            `${dets.length} object${dets.length === 1 ? "" : "s"}` +
              (hidden > 0 ? ` (${hidden} below threshold)` : "") +
              ` · ${(result.ms / 1000).toFixed(2)} s on ${result.device}`,
          )
        : null,
      result && !dets.length ? h("p", { class: "muted small" }, "Nothing above the threshold. Try lowering it or editing the vocabulary.") : null,
      h(
        "ul",
        { class: "dets" },
        dets.map((d, i) =>
          h(
            "li",
            {
              onmouseenter: () => ((hover = i), renderStage(photo, dets)),
              onmouseleave: () => ((hover = -1), renderStage(photo, dets)),
            },
            h("span", { class: "sw", style: `background:${labelColor(d.label)}` }),
            h("span", null, d.label),
            h("span", { class: "spacer" }),
            h("span", { class: "num muted" }, `${Math.round(d.score * 100)}%`),
          ),
        ),
      ),
      ),
    );
  }

  show();
}

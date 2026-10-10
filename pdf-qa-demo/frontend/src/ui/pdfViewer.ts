/**
 * Wraps PDF.js rendering and draws highlight rectangles on a transparent
 * overlay canvas that sits exactly on top of the PDF canvas.
 */
import * as pdfjsLib from "pdfjs-dist";
import type { SourceChunk } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

const HIGHLIGHT_COLORS = [
  { fill: "rgba(245,158,11,0.28)",  stroke: "#F59E0B" },  // amber
  { fill: "rgba(45,212,191,0.28)",  stroke: "#2DD4BF" },  // teal
  { fill: "rgba(251,113,133,0.28)", stroke: "#FB7185" },  // rose
];

export class PDFViewer {
  private wrap: HTMLElement;
  private canvas: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private oc: CanvasRenderingContext2D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pdfDoc: any = null;
  private page = 1;
  private scale = 1.5;

  constructor(wrapId: string) {
    this.wrap = document.getElementById(wrapId)!;
    this.wrap.style.position = "relative";

    this.canvas = document.createElement("canvas");
    this.overlay = document.createElement("canvas");
    this.overlay.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;";

    this.wrap.append(this.canvas, this.overlay);
    this.ctx = this.canvas.getContext("2d")!;
    this.oc = this.overlay.getContext("2d")!;
  }

  async load(file: File): Promise<number> {
    const buf = await file.arrayBuffer();
    this.pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    this.page = 1;
    await this.render(1);
    return this.pdfDoc.numPages as number;
  }

  async render(pageNum: number): Promise<void> {
    if (!this.pdfDoc) return;
    this.page = pageNum;
    const pg = await this.pdfDoc.getPage(pageNum);
    const vp = pg.getViewport({ scale: this.scale });

    this.canvas.width  = this.overlay.width  = vp.width;
    this.canvas.height = this.overlay.height = vp.height;

    await pg.render({ canvasContext: this.ctx, viewport: vp }).promise;
    this.clearHighlights();
  }

  highlight(sources: SourceChunk[]): void {
    this.clearHighlights();
    const w = this.overlay.width;
    const h = this.overlay.height;

    sources.forEach((src, i) => {
      if (src.page !== this.page - 1) return;
      const { fill, stroke } = HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length];
      const [x0, y0, x1, y1] = src.bbox;

      const rx = x0 * w, ry = y0 * h;
      const rw = (x1 - x0) * w, rh = (y1 - y0) * h;

      this.oc.fillStyle = fill;
      this.oc.fillRect(rx, ry, rw, rh);

      this.oc.strokeStyle = stroke;
      this.oc.lineWidth = 2;
      this.oc.strokeRect(rx, ry, rw, rh);

      // Small source badge
      this.oc.fillStyle = stroke;
      this.oc.fillRect(rx, ry - 20, 26, 20);
      this.oc.fillStyle = "#fff";
      this.oc.font = "bold 11px system-ui";
      this.oc.fillText(`S${i + 1}`, rx + 4, ry - 5);
    });

    // Jump to the page that has the first source
    const first = sources[0];
    if (first && first.page !== this.page - 1) {
      this.render(first.page + 1).then(() => this.highlight(sources));
    }
  }

  clearHighlights(): void {
    this.oc.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  prev(): void { if (this.page > 1) this.render(this.page - 1); }
  next(): void { if (this.pdfDoc && this.page < this.pdfDoc.numPages) this.render(this.page + 1); }

  get currentPage() { return this.page; }
  get total(): number { return this.pdfDoc?.numPages ?? 0; }
}

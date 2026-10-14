import assert from "node:assert/strict";
import test from "node:test";
import {
  pdfFileNameForDocument,
  renderMarkdownDocumentToPdfBase64,
} from "../src/pdfExport.ts";

test("PDF filenames keep the existing Markdown and unsafe-character rules", () => {
  assert.equal(
    pdfFileNameForDocument({
      body: "",
      filePath: "/notes/report.markdown",
      path: "/notes/report.markdown",
      title: "Ignored title",
    }),
    "report.pdf",
  );
  assert.equal(
    pdfFileNameForDocument({ body: "", filePath: null, path: "", title: " A/B:*? " }),
    "A_B___.pdf",
  );
  assert.equal(
    pdfFileNameForDocument({
      body: "",
      filePath: null,
      path: "  C:\\notes\\spaced.mdown  ",
      title: "Ignored title",
    }),
    "spaced.pdf",
  );
});

test("the PDF render pipeline produces a complete PDF document", async () => {
  const drawnText: string[] = [];
  const context = {
    beginPath() {},
    drawImage() {},
    fillRect() {},
    fillText(text: string) {
      drawnText.push(text);
    },
    font: "",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    lineTo() {},
    lineWidth: 1,
    measureText(text: string) {
      return { width: Array.from(text).length * 8 };
    },
    moveTo() {},
    restore() {},
    save() {},
    scale() {},
    setLineDash() {},
    stroke() {},
    strokeRect() {},
    strokeStyle: "",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
  const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(tagName: string) {
        assert.equal(tagName, "canvas");
        return {
          getContext: (kind: string) => (kind === "2d" ? context : null),
          height: 0,
          toDataURL: () => `data:image/jpeg;base64,${jpegBase64}`,
          width: 0,
        };
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { atob: globalThis.atob, btoa: globalThis.btoa },
  });

  try {
    const pdfBase64 = await renderMarkdownDocumentToPdfBase64(
      { body: "# 標題\n\n內容", filePath: null, path: "note.md", title: "Note" },
      "圖片無法顯示",
      () => [
        { kind: "heading", level: 1, text: "標題" },
        { kind: "paragraph", text: "內容" },
      ],
    );
    const pdf = Buffer.from(pdfBase64, "base64").toString("latin1");

    assert.equal(pdf.startsWith("%PDF-1.4"), true);
    assert.equal(pdf.includes("/Type /Page"), true);
    assert.equal(pdf.trimEnd().endsWith("%%EOF"), true);
    assert.deepEqual(drawnText, ["標題", "內容"]);
  } finally {
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      delete (globalThis as { document?: Document }).document;
    }
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: Window }).window;
    }
  }
});

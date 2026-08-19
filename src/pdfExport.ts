import { localMarkdownImageNeedsHydration } from "./markdownLinkTarget.ts";
import { readMarkdownImageFile } from "./tauriGateway.ts";
import { fileNameFromPath, stripMarkdownExtension } from "./workspacePaths.ts";

export type PdfExportDocument = {
  body: string;
  filePath: string | null;
  path: string;
  title: string;
};

type PdfMarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "unordered-list" | "ordered-list"; items: string[] }
  | { kind: "rule" };

type ParseMarkdownBlocks = (markdown: string) => PdfMarkdownBlock[];

const pdfCssPageWidth = 794;
const pdfCssPageHeight = 1123;
const pdfPageWidthPoints = 595.28;
const pdfPageHeightPoints = 841.89;
const pdfRenderScale = 2;

type PdfJpegPage = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

type PdfSvgTextElement = {
  kind: "text";
  fill: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  text: string;
  x: number;
  y: number;
};

type PdfSvgRectElement = {
  kind: "rect";
  fill: string;
  height: number;
  rx?: number;
  stroke?: string;
  strokeDasharray?: string;
  width: number;
  x: number;
  y: number;
};

type PdfSvgLineElement = {
  kind: "line";
  stroke: string;
  strokeWidth: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

type PdfSvgImageElement = {
  kind: "image";
  alt: string;
  height: number;
  src: string;
  width: number;
  x: number;
  y: number;
};

type PdfSvgElement =
  | PdfSvgTextElement
  | PdfSvgRectElement
  | PdfSvgLineElement
  | PdfSvgImageElement;

type PdfSvgPage = {
  elements: PdfSvgElement[];
};

type PdfInlinePart =
  | {
      kind: "text";
      text: string;
    }
  | {
      alt: string;
      kind: "image";
      src: string;
    };

type PdfTextStyle = {
  fill: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
};

type PdfImageLayout = {
  alt: string;
  dataUrl: string;
  height: number;
  width: number;
};

const pdfPagePaddingX = 72;
const pdfPagePaddingY = 64;
const pdfContentWidth = pdfCssPageWidth - pdfPagePaddingX * 2;
const pdfContentBottom = pdfCssPageHeight - pdfPagePaddingY;
const pdfMaxImageHeight = 720;
const pdfBodyFontFamily =
  '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Helvetica Neue", Arial, sans-serif';
const pdfMonoFontFamily = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
const pdfBodyTextStyle: PdfTextStyle = {
  fill: "#161616",
  fontFamily: pdfBodyFontFamily,
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 26,
};
const pdfQuoteTextStyle: PdfTextStyle = {
  ...pdfBodyTextStyle,
  fill: "#4b5563",
};
const pdfCodeTextStyle: PdfTextStyle = {
  fill: "#24292f",
  fontFamily: pdfMonoFontFamily,
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 19,
};
const pdfImageFallbackStyle: PdfTextStyle = {
  fill: "#6b7280",
  fontFamily: pdfBodyFontFamily,
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 19,
};

function sanitizedPdfFileName(value: string) {
  const sanitized = stripMarkdownExtension(value.trim().replace(/\.(pdf)$/i, ""))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "");

  return `${sanitized || "Scholium"}.pdf`;
}

export function pdfFileNameForDocument(exportDocument: PdfExportDocument) {
  const sourceFileName = fileNameFromPath(exportDocument.path.trim());
  return sanitizedPdfFileName(stripMarkdownExtension(sourceFileName) || exportDocument.title);
}

function isDataImageSource(src: string) {
  return /^data:image\//i.test(src.trim());
}

async function resolvePdfImageSource(markdownPath: string | null, imageSrc: string) {
  if (isDataImageSource(imageSrc)) return imageSrc;
  if (!markdownPath || !localMarkdownImageNeedsHydration(imageSrc)) return "";

  const result = await readMarkdownImageFile({
    markdownPath,
    imageSrc,
  });

  return result.dataUrl;
}

function markdownInlineToPlainText(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

function parsePdfInlineParts(text: string) {
  const parts: PdfInlinePart[] = [];
  const imageTokenPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(imageTokenPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      const textPart = markdownInlineToPlainText(text.slice(lastIndex, index));
      if (textPart) {
        parts.push({ kind: "text", text: textPart });
      }
    }

    parts.push({
      alt: match[1] ?? "",
      kind: "image",
      src: match[2] ?? "",
    });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    const textPart = markdownInlineToPlainText(text.slice(lastIndex));
    if (textPart) {
      parts.push({ kind: "text", text: textPart });
    }
  }

  return parts;
}

function loadPdfImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("failed to render PDF page image"));
    image.src = src;
  });
}

async function resolvePdfImageLayout(
  markdownPath: string | null,
  imageSrc: string,
  alt: string,
): Promise<PdfImageLayout | null> {
  const dataUrl = await resolvePdfImageSource(markdownPath, imageSrc);
  if (!dataUrl) return null;

  const image = await loadPdfImage(dataUrl);
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;

  return {
    alt,
    dataUrl,
    height: image.naturalHeight,
    width: image.naturalWidth,
  };
}

function pdfHeadingTextStyle(level: number): PdfTextStyle {
  if (level <= 1) {
    return {
      fill: "#111827",
      fontFamily: pdfBodyFontFamily,
      fontSize: 34,
      fontWeight: 700,
      lineHeight: 42,
    };
  }
  if (level === 2) {
    return {
      fill: "#111827",
      fontFamily: pdfBodyFontFamily,
      fontSize: 26,
      fontWeight: 700,
      lineHeight: 33,
    };
  }
  if (level === 3) {
    return {
      fill: "#111827",
      fontFamily: pdfBodyFontFamily,
      fontSize: 21,
      fontWeight: 700,
      lineHeight: 28,
    };
  }

  return {
    fill: "#111827",
    fontFamily: pdfBodyFontFamily,
    fontSize: 17,
    fontWeight: 700,
    lineHeight: 24,
  };
}

function createPdfTextMeasureContext() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("failed to create PDF text measurement context");

  return context;
}

function pdfCanvasFont(style: PdfTextStyle) {
  return `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

function measurePdfText(
  context: CanvasRenderingContext2D,
  text: string,
  style: PdfTextStyle,
) {
  context.font = pdfCanvasFont(style);
  return context.measureText(text).width;
}

function isPdfCjkWrapCharacter(character: string) {
  return /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(character);
}

function splitPdfWrapUnits(text: string) {
  const units: string[] = [];
  let word = "";

  const flushWord = () => {
    if (!word) return;
    units.push(word);
    word = "";
  };

  for (const character of Array.from(text)) {
    if (character === "\n") {
      flushWord();
      units.push("\n");
    } else if (/\s/.test(character)) {
      flushWord();
      units.push(" ");
    } else if (isPdfCjkWrapCharacter(character)) {
      flushWord();
      units.push(character);
    } else {
      word += character;
    }
  }

  flushWord();
  return units;
}

function wrapOversizedPdfUnit(
  context: CanvasRenderingContext2D,
  unit: string,
  maxWidth: number,
  style: PdfTextStyle,
) {
  const lines: string[] = [];
  let current = "";

  for (const character of Array.from(unit)) {
    const candidate = `${current}${character}`;
    if (current && measurePdfText(context, candidate, style) > maxWidth) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function wrapPdfText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  style: PdfTextStyle,
) {
  const lines: string[] = [];
  let current = "";

  for (const unit of splitPdfWrapUnits(text)) {
    if (unit === "\n") {
      lines.push(current.trimEnd());
      current = "";
      continue;
    }
    if (unit === " " && !current) continue;

    const nextUnit = current ? unit : unit.trimStart();
    const candidate = `${current}${nextUnit}`;
    if (!current || measurePdfText(context, candidate, style) <= maxWidth) {
      current = candidate;
      continue;
    }

    lines.push(current.trimEnd());
    if (measurePdfText(context, nextUnit, style) > maxWidth) {
      const oversizedLines = wrapOversizedPdfUnit(context, nextUnit, maxWidth, style);
      current = oversizedLines.pop() ?? "";
      lines.push(...oversizedLines);
    } else {
      current = nextUnit.trimStart();
    }
  }

  if (current.trimEnd()) {
    lines.push(current.trimEnd());
  }

  return lines;
}

function wrapPdfCodeLine(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  style: PdfTextStyle,
) {
  if (!text) return [""];

  const lines: string[] = [];
  let current = "";

  for (const character of Array.from(text)) {
    const printableCharacter = character === " " ? "\u00a0" : character;
    const candidate = `${current}${printableCharacter}`;
    if (current && measurePdfText(context, candidate, style) > maxWidth) {
      lines.push(current);
      current = printableCharacter;
    } else {
      current = candidate;
    }
  }

  lines.push(current);
  return lines;
}

class PdfSvgLayout {
  private currentPage: PdfSvgPage;
  private readonly pages: PdfSvgPage[];
  private readonly textContext: CanvasRenderingContext2D;
  private y: number;

  constructor(textContext: CanvasRenderingContext2D) {
    this.currentPage = { elements: [] };
    this.pages = [this.currentPage];
    this.textContext = textContext;
    this.y = pdfPagePaddingY;
  }

  getPages() {
    return this.pages;
  }

  getCursorY() {
    return this.y;
  }

  private isAtPageTop() {
    return this.y <= pdfPagePaddingY + 0.1 && this.currentPage.elements.length === 0;
  }

  private startNewPage() {
    this.currentPage = { elements: [] };
    this.pages.push(this.currentPage);
    this.y = pdfPagePaddingY;
  }

  addGap(height: number) {
    if (height <= 0 || this.isAtPageTop()) return;
    this.y = Math.min(pdfContentBottom, this.y + height);
  }

  ensureSpace(height: number) {
    if (this.y + height <= pdfContentBottom || this.isAtPageTop()) return;
    this.startNewPage();
  }

  addLine(element: Omit<PdfSvgLineElement, "kind">) {
    this.currentPage.elements.push({ kind: "line", ...element });
  }

  addRect(element: Omit<PdfSvgRectElement, "kind">) {
    this.currentPage.elements.push({ kind: "rect", ...element });
  }

  addTextLine(text: string, x: number, style: PdfTextStyle) {
    this.ensureSpace(style.lineHeight);
    this.currentPage.elements.push({
      fill: style.fill,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      kind: "text",
      text,
      x,
      y: this.y + style.fontSize,
    });
    this.y += style.lineHeight;
  }

  addWrappedText(
    text: string,
    x: number,
    maxWidth: number,
    style: PdfTextStyle,
    options: { marginBottom?: number; marginTop?: number } = {},
  ) {
    const lines = wrapPdfText(this.textContext, text, maxWidth, style);
    if (lines.length === 0) return;

    this.addGap(options.marginTop ?? 0);
    for (const line of lines) {
      this.addTextLine(line, x, style);
    }
    this.addGap(options.marginBottom ?? 0);
  }

  addListItem(marker: string, text: string, style: PdfTextStyle) {
    const markerX = pdfPagePaddingX;
    const textX = pdfPagePaddingX + 28;
    const lines = wrapPdfText(this.textContext, text, pdfContentWidth - 28, style);
    if (lines.length === 0) return;

    this.addGap(2);
    lines.forEach((line, index) => {
      this.ensureSpace(style.lineHeight);
      if (index === 0) {
        this.currentPage.elements.push({
          fill: style.fill,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          kind: "text",
          text: marker,
          x: markerX,
          y: this.y + style.fontSize,
        });
      }
      this.currentPage.elements.push({
        fill: style.fill,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        kind: "text",
        text: line,
        x: textX,
        y: this.y + style.fontSize,
      });
      this.y += style.lineHeight;
    });
  }

  addCodeBlock(text: string) {
    const codePaddingX = 16;
    const codePaddingY = 14;
    const lines = text
      .split("\n")
      .flatMap((line) =>
        wrapPdfCodeLine(
          this.textContext,
          line,
          pdfContentWidth - codePaddingX * 2,
          pdfCodeTextStyle,
        ),
      );
    const remainingLines = lines.length > 0 ? lines : [""];

    this.addGap(16);
    while (remainingLines.length > 0) {
      const availableHeight = Math.max(
        pdfCodeTextStyle.lineHeight + codePaddingY * 2,
        pdfContentBottom - this.y,
      );
      const maxLinesOnPage = Math.max(
        1,
        Math.floor((availableHeight - codePaddingY * 2) / pdfCodeTextStyle.lineHeight),
      );
      const pageLines = remainingLines.splice(0, maxLinesOnPage);
      const blockHeight = pageLines.length * pdfCodeTextStyle.lineHeight + codePaddingY * 2;

      this.ensureSpace(blockHeight);
      this.addRect({
        fill: "#f6f8fa",
        height: blockHeight,
        rx: 6,
        stroke: "#d8dee4",
        width: pdfContentWidth,
        x: pdfPagePaddingX,
        y: this.y,
      });
      let lineY = this.y + codePaddingY;
      for (const line of pageLines) {
        this.currentPage.elements.push({
          fill: pdfCodeTextStyle.fill,
          fontFamily: pdfCodeTextStyle.fontFamily,
          fontSize: pdfCodeTextStyle.fontSize,
          fontWeight: pdfCodeTextStyle.fontWeight,
          kind: "text",
          text: line,
          x: pdfPagePaddingX + codePaddingX,
          y: lineY + pdfCodeTextStyle.fontSize,
        });
        lineY += pdfCodeTextStyle.lineHeight;
      }
      this.y += blockHeight;
      if (remainingLines.length > 0) this.startNewPage();
    }
    this.addGap(12);
  }

  addImage(image: PdfImageLayout) {
    const maxHeight = Math.min(pdfMaxImageHeight, pdfContentBottom - pdfPagePaddingY);
    const scale = Math.min(1, pdfContentWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;

    this.addGap(16);
    this.ensureSpace(height);
    this.currentPage.elements.push({
      alt: image.alt,
      height,
      kind: "image",
      src: image.dataUrl,
      width,
      x: pdfPagePaddingX + (pdfContentWidth - width) / 2,
      y: this.y,
    });
    this.y += height;
    this.addGap(16);
  }

  addImageFallback(label: string) {
    const height = 42;
    this.addGap(14);
    this.ensureSpace(height);
    this.addRect({
      fill: "#f6f8fa",
      height,
      rx: 6,
      stroke: "#aeb6c2",
      strokeDasharray: "6 4",
      width: pdfContentWidth,
      x: pdfPagePaddingX,
      y: this.y,
    });
    this.currentPage.elements.push({
      fill: pdfImageFallbackStyle.fill,
      fontFamily: pdfImageFallbackStyle.fontFamily,
      fontSize: pdfImageFallbackStyle.fontSize,
      fontWeight: pdfImageFallbackStyle.fontWeight,
      kind: "text",
      text: label,
      x: pdfPagePaddingX + 12,
      y: this.y + 26,
    });
    this.y += height;
    this.addGap(12);
  }

  addRule(gapBefore = 20, gapAfter = 20) {
    this.addGap(gapBefore);
    this.ensureSpace(1);
    this.addLine({
      stroke: "#d8dee4",
      strokeWidth: 1,
      x1: pdfPagePaddingX,
      x2: pdfPagePaddingX + pdfContentWidth,
      y1: this.y,
      y2: this.y,
    });
    this.addGap(gapAfter);
  }
}

async function addPdfInlineParts(
  layout: PdfSvgLayout,
  markdownPath: string | null,
  parts: PdfInlinePart[],
  style: PdfTextStyle,
  imageUnavailableLabel: string,
  options: { indent?: number; marginBottom?: number; marginTop?: number } = {},
) {
  const indent = options.indent ?? 0;
  let hasAddedContent = false;

  for (const part of parts) {
    if (part.kind === "text") {
      layout.addWrappedText(part.text, pdfPagePaddingX + indent, pdfContentWidth - indent, style, {
        marginTop: hasAddedContent ? 4 : options.marginTop,
      });
      hasAddedContent = true;
    } else {
      try {
        const image = await resolvePdfImageLayout(markdownPath, part.src, part.alt);
        if (image) {
          layout.addImage(image);
        } else {
          layout.addImageFallback(part.alt || part.src || imageUnavailableLabel);
        }
      } catch {
        layout.addImageFallback(part.alt || part.src || imageUnavailableLabel);
      }
      hasAddedContent = true;
    }
  }

  if (hasAddedContent) {
    layout.addGap(options.marginBottom ?? 0);
  }
}

async function layoutMarkdownDocumentForPdf(
  exportDocument: PdfExportDocument,
  imageUnavailableLabel: string,
  parseMarkdownBlocks: ParseMarkdownBlocks,
) {
  const blocks = parseMarkdownBlocks(exportDocument.body);
  const layout = new PdfSvgLayout(createPdfTextMeasureContext());
  const markdownPath = exportDocument.filePath;

  if (blocks.length === 0) {
    return layout.getPages();
  }

  for (const block of blocks) {
    if (block.kind === "heading") {
      const style = pdfHeadingTextStyle(block.level);
      layout.addWrappedText(
        markdownInlineToPlainText(block.text),
        pdfPagePaddingX,
        pdfContentWidth,
        style,
        {
          marginBottom: block.level === 2 ? 6 : 8,
          marginTop: block.level <= 2 ? 24 : 18,
        },
      );
      if (block.level === 2) {
        layout.addRule(0, 18);
      }
    } else if (block.kind === "paragraph") {
      await addPdfInlineParts(
        layout,
        markdownPath,
        parsePdfInlineParts(block.text),
        pdfBodyTextStyle,
        imageUnavailableLabel,
        {
          marginBottom: 10,
          marginTop: 4,
        },
      );
    } else if (block.kind === "quote") {
      layout.addGap(14);
      const quoteStartY = layout.getCursorY();
      await addPdfInlineParts(
        layout,
        markdownPath,
        parsePdfInlineParts(block.text),
        pdfQuoteTextStyle,
        imageUnavailableLabel,
        {
          indent: 16,
          marginBottom: 10,
        },
      );
      const quoteEndY = layout.getCursorY();
      if (quoteEndY > quoteStartY) {
        layout.addLine({
          stroke: "#8a2438",
          strokeWidth: 4,
          x1: pdfPagePaddingX,
          x2: pdfPagePaddingX,
          y1: quoteStartY,
          y2: quoteEndY - 10,
        });
      }
    } else if (block.kind === "unordered-list" || block.kind === "ordered-list") {
      layout.addGap(8);
      for (const [index, item] of block.items.entries()) {
        const plainText = markdownInlineToPlainText(item);
        const marker = block.kind === "ordered-list" ? `${index + 1}.` : "•";
        layout.addListItem(marker, plainText, pdfBodyTextStyle);
      }
      layout.addGap(10);
    } else if (block.kind === "code") {
      layout.addCodeBlock(block.text);
    } else if (block.kind === "rule") {
      layout.addRule();
    }
  }

  return layout.getPages();
}

function drawPdfRect(context: CanvasRenderingContext2D, element: PdfSvgRectElement) {
  context.save();
  context.fillStyle = element.fill;
  context.fillRect(element.x, element.y, element.width, element.height);

  if (element.stroke) {
    context.strokeStyle = element.stroke;
    context.lineWidth = 1;
    if (element.strokeDasharray) {
      context.setLineDash(
        element.strokeDasharray
          .split(/\s+/)
          .map(Number)
          .filter((value) => Number.isFinite(value) && value > 0),
      );
    }
    context.strokeRect(element.x, element.y, element.width, element.height);
  }

  context.restore();
}

async function drawPdfPageElement(
  context: CanvasRenderingContext2D,
  element: PdfSvgElement,
) {
  if (element.kind === "text") {
    context.save();
    context.fillStyle = element.fill;
    context.font = `${element.fontWeight} ${element.fontSize}px ${element.fontFamily}`;
    context.textBaseline = "alphabetic";
    context.fillText(element.text, element.x, element.y);
    context.restore();
    return;
  }

  if (element.kind === "rect") {
    drawPdfRect(context, element);
    return;
  }

  if (element.kind === "line") {
    context.save();
    context.strokeStyle = element.stroke;
    context.lineWidth = element.strokeWidth;
    context.beginPath();
    context.moveTo(element.x1, element.y1);
    context.lineTo(element.x2, element.y2);
    context.stroke();
    context.restore();
    return;
  }

  const image = await loadPdfImage(element.src);
  context.drawImage(image, element.x, element.y, element.width, element.height);
}

async function renderPdfPageToJpeg(page: PdfSvgPage) {
  const canvas = document.createElement("canvas");
  const width = pdfCssPageWidth * pdfRenderScale;
  const height = pdfCssPageHeight * pdfRenderScale;
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("failed to create PDF render canvas");

  context.scale(pdfRenderScale, pdfRenderScale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, pdfCssPageWidth, pdfCssPageHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  for (const element of page.elements) {
    await drawPdfPageElement(context, element);
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return {
    bytes: base64ToUint8Array(dataUrl.split(",", 2)[1] ?? ""),
    width,
    height,
  };
}

export async function renderMarkdownDocumentToPdfBase64(
  exportDocument: PdfExportDocument,
  imageUnavailableLabel: string,
  parseMarkdownBlocks: ParseMarkdownBlocks,
) {
  const pages = await layoutMarkdownDocumentForPdf(
    exportDocument,
    imageUnavailableLabel,
    parseMarkdownBlocks,
  );
  const jpegPages: PdfJpegPage[] = [];

  for (const page of pages) {
    jpegPages.push(await renderPdfPageToJpeg(page));
  }

  return uint8ArrayToBase64(buildPdfFromJpegPages(jpegPages));
}

function base64ToUint8Array(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return window.btoa(binary);
}

function asciiBytes(text: string) {
  return new TextEncoder().encode(text);
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }

  return merged;
}

function pdfObject(id: number, body: string) {
  return asciiBytes(`${id} 0 obj\n${body}\nendobj\n`);
}

function pdfStreamObject(id: number, dictionary: string, stream: Uint8Array) {
  return concatBytes([
    asciiBytes(`${id} 0 obj\n<< ${dictionary} /Length ${stream.length} >>\nstream\n`),
    stream,
    asciiBytes("\nendstream\nendobj\n"),
  ]);
}

function buildPdfFromJpegPages(pages: PdfJpegPage[]) {
  const objects: { id: number; bytes: Uint8Array }[] = [];
  const pageIds = pages.map((_, pageIndex) => 3 + pageIndex * 3);

  objects.push({
    id: 1,
    bytes: pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
  });
  objects.push({
    id: 2,
    bytes: pdfObject(
      2,
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${
        pages.length
      } >>`,
    ),
  });

  pages.forEach((page, pageIndex) => {
    const pageObjectId = 3 + pageIndex * 3;
    const contentObjectId = pageObjectId + 1;
    const imageObjectId = pageObjectId + 2;
    const imageName = `Im${pageIndex + 1}`;
    const contentStream = asciiBytes(
      `q\n${pdfPageWidthPoints} 0 0 ${pdfPageHeightPoints} 0 0 cm\n/${imageName} Do\nQ\n`,
    );

    objects.push({
      id: pageObjectId,
      bytes: pdfObject(
        pageObjectId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfPageWidthPoints} ${pdfPageHeightPoints}] /Resources << /XObject << /${imageName} ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      ),
    });
    objects.push({
      id: contentObjectId,
      bytes: pdfStreamObject(contentObjectId, "", contentStream),
    });
    objects.push({
      id: imageObjectId,
      bytes: pdfStreamObject(
        imageObjectId,
        `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
        page.bytes,
      ),
    });
  });

  objects.sort((left, right) => left.id - right.id);

  const header = asciiBytes("%PDF-1.4\n");
  const parts: Uint8Array[] = [header];
  const offsets = [0];
  let offset = header.length;

  for (const object of objects) {
    offsets[object.id] = offset;
    parts.push(object.bytes);
    offset += object.bytes.length;
  }

  const xrefOffset = offset;
  const objectCount = objects.length + 1;
  const xrefLines = [
    "xref",
    `0 ${objectCount}`,
    "0000000000 65535 f ",
    ...objects.map((object) => `${String(offsets[object.id]).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objectCount} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ];
  parts.push(asciiBytes(xrefLines.join("\n")));

  return concatBytes(parts);
}

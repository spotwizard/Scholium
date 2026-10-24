import {
  normalizeListItemStrongTrailingWhitespace,
  normalizeSerializedBulletMarkers,
  restoreListLeadingAsterisksFromPreview,
} from "./markdownListLiteral.ts";
import { normalizeAdjacentSerializedListItems } from "./milkdownListIndent.ts";

const standaloneHtmlBreakPattern = /^<br\s*\/?>$/i;

export function normalizeSelectedText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isStandaloneSerializedBreakLine(line: string) {
  return standaloneHtmlBreakPattern.test(line.trim());
}

function normalizeSerializedEmptyParagraphBreaks(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalizedLines: string[] = [];
  let inFencedCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFencedCodeBlock = !inFencedCodeBlock;
      normalizedLines.push(line);
      continue;
    }

    if (!inFencedCodeBlock && isStandaloneSerializedBreakLine(line)) {
      normalizedLines.push("");

      if (
        normalizedLines.length >= 2 &&
        !normalizedLines[normalizedLines.length - 2]?.trim() &&
        !(lines[index + 1] ?? "").trim()
      ) {
        index += 1;
      }

      continue;
    }

    if (!inFencedCodeBlock) {
      const emptyListItemBreak = line.match(
        /^(\s*(?:[-+*]|\d+[.)]))\s+<br\s*\/?>\s*$/i,
      );
      if (emptyListItemBreak) {
        const marker = emptyListItemBreak[1] ?? line;
        normalizedLines.push(marker);

        // A bare marker followed by a blank line ends the item in Markdown, so
        // the sub-list of an empty item (one that Tab moved under it) would be
        // read back as siblings of that item. Keep the sub-list right below it.
        let nextContentIndex = index + 1;
        while (nextContentIndex < lines.length && !(lines[nextContentIndex] ?? "").trim()) {
          nextContentIndex += 1;
        }
        const childListItem = (lines[nextContentIndex] ?? "").match(
          /^(\s*)(?:[-+*]|\d+[.)])(?:\s|$)/,
        );
        if (childListItem && (childListItem[1] ?? "").length > marker.length) {
          index = nextContentIndex - 1;
        }
        continue;
      }
    }

    normalizedLines.push(line);
  }

  return normalizedLines.join("\n");
}

function normalizeSerializedHardBreaks(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalizedLines: string[] = [];
  let inFencedCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFencedCodeBlock = !inFencedCodeBlock;
      normalizedLines.push(line);
      continue;
    }

    const trailingBackslashCount = line.match(/\\+$/)?.[0].length ?? 0;
    if (
      !inFencedCodeBlock &&
      index < lines.length - 1 &&
      trailingBackslashCount % 2 === 1
    ) {
      normalizedLines.push(line.slice(0, -1));
      continue;
    }

    normalizedLines.push(line);
  }

  return normalizedLines.join("\n");
}

function restoreSerializedInlineLinks(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalizedLines: string[] = [];
  let inFencedCodeBlock = false;

  for (const line of lines) {
    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFencedCodeBlock = !inFencedCodeBlock;
      normalizedLines.push(line);
      continue;
    }

    if (inFencedCodeBlock) {
      normalizedLines.push(line);
      continue;
    }

    normalizedLines.push(
      line.replace(/\\\[([^\]\n]*)\]\\\(([^)\n]*)\)/g, (match, label, href, offset) =>
        line[offset - 1] === "!" ? match : `[${label}](${href})`,
      ),
    );
  }

  return normalizedLines.join("\n");
}

export function normalizeMarkdownForScholium(markdown: string) {
  return restoreListLeadingAsterisksFromPreview(
    normalizeAdjacentSerializedListItems(
      normalizeListItemStrongTrailingWhitespace(
        normalizeSerializedBulletMarkers(
          restoreSerializedInlineLinks(
            normalizeSerializedHardBreaks(normalizeSerializedEmptyParagraphBreaks(markdown)),
          ),
        ),
      ),
    ),
  );
}

export function encodeEmptyParagraphsForMilkdown(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const encodedLines: string[] = [];
  let inFencedCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFencedCodeBlock = !inFencedCodeBlock;
      encodedLines.push(line);
      continue;
    }

    if (!inFencedCodeBlock && !line.trim()) {
      let blankEnd = index;
      while (blankEnd < lines.length && !(lines[blankEnd] ?? "").trim()) {
        blankEnd += 1;
      }

      const blankCount = blankEnd - index;
      const hasPreviousContent = encodedLines.some((candidate) => candidate.trim());
      const hasNextContent = lines.slice(blankEnd).some((candidate) => candidate.trim());

      if (hasPreviousContent && hasNextContent) {
        encodedLines.push("");
        for (let blankIndex = 1; blankIndex < blankCount; blankIndex += 1) {
          encodedLines.push("<br />", "");
        }
      } else {
        for (let blankIndex = 0; blankIndex < blankCount; blankIndex += 1) {
          encodedLines.push("");
        }
      }

      index = blankEnd - 1;
      continue;
    }

    encodedLines.push(line);
  }

  return encodedLines.join("\n");
}

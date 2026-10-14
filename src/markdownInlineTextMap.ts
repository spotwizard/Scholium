export type MarkdownTextMap = {
  text: string;
  sourceOffsets: (number | null)[];
};

export function appendTextMap(
  target: MarkdownTextMap,
  text: string,
  sourceStart: number | null,
) {
  target.text += text;
  for (let index = 0; index < text.length; index += 1) {
    target.sourceOffsets.push(sourceStart === null ? null : sourceStart + index);
  }
}

export function closestTextIndex(indices: number[], approximateIndex: number) {
  if (indices.length === 0) return -1;

  return indices.reduce((closestIndex, index) =>
    Math.abs(index - approximateIndex) < Math.abs(closestIndex - approximateIndex)
      ? index
      : closestIndex,
  );
}

export function findNonOverlappingTextIndices(text: string, query: string) {
  const indices: number[] = [];
  if (!query) return indices;

  let index = text.indexOf(query);
  while (index >= 0) {
    indices.push(index);
    index = text.indexOf(query, index + query.length);
  }

  return indices;
}

export function markdownLineStartOffsets(markdown: string) {
  const offsets = [0];

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === "\n") {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

export function markdownListItemContentStartOffset(line: string) {
  return line.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/)?.[0].length ?? 0;
}

function isMarkdownEscapablePunctuation(character: string) {
  const code = character.codePointAt(0) ?? 0;
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

export function appendInlineMarkdownTextMap(
  target: MarkdownTextMap,
  text: string,
  sourceStart: number,
) {
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    const escapedCharacter = text[index + 1] ?? "";
    if (character === "\\" && isMarkdownEscapablePunctuation(escapedCharacter)) {
      appendTextMap(target, escapedCharacter, sourceStart + index + 1);
      index += 2;
      continue;
    }

    const twoCharacterMarker = text.slice(index, index + 2);

    if (twoCharacterMarker === "**" || twoCharacterMarker === "__") {
      const endIndex = text.indexOf(twoCharacterMarker, index + 2);
      if (endIndex > index + 2) {
        appendInlineMarkdownTextMap(
          target,
          text.slice(index + 2, endIndex),
          sourceStart + index + 2,
        );
        index = endIndex + 2;
        continue;
      }
    }

    if (character === "*" || character === "_") {
      const endIndex = text.indexOf(character, index + 1);
      if (endIndex > index + 1) {
        appendInlineMarkdownTextMap(
          target,
          text.slice(index + 1, endIndex),
          sourceStart + index + 1,
        );
        index = endIndex + 1;
        continue;
      }
    }

    if (character === "`") {
      const endIndex = text.indexOf("`", index + 1);
      if (endIndex > index + 1) {
        appendTextMap(target, text.slice(index + 1, endIndex), sourceStart + index + 1);
        index = endIndex + 1;
        continue;
      }
    }

    if (character === "[") {
      const labelEndIndex = text.indexOf("](", index + 1);
      if (labelEndIndex > index + 1) {
        const linkEndIndex = text.indexOf(")", labelEndIndex + 2);
        if (linkEndIndex > labelEndIndex + 2) {
          appendInlineMarkdownTextMap(
            target,
            text.slice(index + 1, labelEndIndex),
            sourceStart + index + 1,
          );
          index = linkEndIndex + 1;
          continue;
        }
      }
    }

    appendTextMap(target, character, sourceStart + index);
    index += 1;
  }
}

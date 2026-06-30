export type DocumentSearchMatch = {
  from: number;
  to: number;
};

export type DocumentSearchState = {
  activeIndex: number;
  query: string;
};

export function normalizeDocumentSearchQuery(query: string) {
  return query.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function buildNormalizedSearchTextIndex(text: string) {
  const chars: string[] = [];
  const positions: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (/\s/.test(char)) {
      if (chars.length > 0 && chars[chars.length - 1] !== " ") {
        chars.push(" ");
        positions.push(index);
      }
      continue;
    }

    chars.push(char.toLocaleLowerCase());
    positions.push(index);
  }

  return {
    positions,
    text: chars.join(""),
  };
}

export function findNormalizedSearchMatchIndexes(text: string, query: string) {
  const matches: Array<{ fromIndex: number; toIndex: number }> = [];
  if (!query) return matches;

  let searchFrom = 0;
  while (searchFrom <= text.length) {
    const index = text.indexOf(query, searchFrom);
    if (index < 0) break;

    matches.push({
      fromIndex: index,
      toIndex: index + query.length,
    });
    searchFrom = index + query.length;
  }

  return matches;
}

export function findDocumentSearchMatches(text: string, query: string): DocumentSearchMatch[] {
  const normalizedQuery = normalizeDocumentSearchQuery(query);
  if (!normalizedQuery) return [];

  const textIndex = buildNormalizedSearchTextIndex(text);
  return findNormalizedSearchMatchIndexes(textIndex.text, normalizedQuery)
    .map((match) => {
      const from = textIndex.positions[match.fromIndex];
      const lastPosition = textIndex.positions[match.toIndex - 1];

      if (from === undefined || lastPosition === undefined) return null;

      return {
        from,
        to: lastPosition + 1,
      };
    })
    .filter((match): match is DocumentSearchMatch => Boolean(match && match.to > match.from));
}

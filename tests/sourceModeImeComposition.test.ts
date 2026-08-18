import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };
const packageLock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
) as { packages: Record<string, { version?: string }> };
const sourceEditor = readFileSync(new URL("../src/MarkdownEditor.tsx", import.meta.url), "utf8");

function versionAtLeast(actual: string, minimum: string) {
  const actualParts = actual.replace(/^\D+/, "").split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);
  for (let index = 0; index < minimumParts.length; index += 1) {
    if (actualParts[index] !== minimumParts[index]) {
      return (actualParts[index] ?? 0) > minimumParts[index];
    }
  }
  return true;
}

assert.ok(
  versionAtLeast(packageJson.dependencies["@codemirror/view"], "6.43.7"),
  "the source editor must require the accumulated CodeMirror Safari IME and DOM-update fixes",
);
assert.ok(
  versionAtLeast(packageLock.packages["node_modules/@codemirror/view"]?.version ?? "0.0.0", "6.43.7"),
  "the lockfile must install the verified CodeMirror Safari IME fix version or newer",
);
assert.doesNotMatch(
  sourceEditor,
  /compositionstart|compositionend|searchCompositionActiveRef|emptyDocumentSearchState/,
  "the app must not replace CodeMirror's native IME handling with a search-highlight workaround",
);
assert.match(
  sourceEditor,
  /applySearchState\(view, search, true\);/,
  "normal search updates must still update and scroll the active match",
);

console.log("source mode CodeMirror Safari IME dependency regression: PASS");

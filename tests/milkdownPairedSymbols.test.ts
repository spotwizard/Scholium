import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

for (const pair of [
  '"(": ")"',
  '"[": "]"',
  '"{": "}"',
  '"\\"": "\\""',
  '"\'": "\'"',
  '"（": "）"',
  '"［": "］"',
  '"｛": "｝"',
  '"【": "】"',
  '"「": "」"',
  '"『": "』"',
  '"〈": "〉"',
  '"《": "》"',
]) {
  assert.ok(editor.includes(pair), `missing paired symbol ${pair}`);
}

assert.match(editor, /function createPairedSymbolPlugin\(\)/);
assert.match(
  editor,
  /handleTextInput\(view, from, to, text\) \{\s*if \(\s*view\.composing \|\|[\s\S]*?return false;[\s\S]*?const closingSymbol = markdownPairedSymbols\[text\]/,
);
assert.match(editor, /tr\.insertText\(`\$\{text\}\$\{closingSymbol\}`/);
assert.match(editor, /TextSelection\.create\(tr\.doc, from \+ text\.length\)/);
assert.match(editor, /tr\.insertText\(closingSymbol, to\);[\s\S]*?tr\.insertText\(text, from\);/);
assert.match(editor, /nextCharacter !== event\.key/);
assert.match(editor, /if \(event\.key === "Backspace"\)/);
assert.match(
  editor,
  /markdownPairedSymbols\[previousCharacter\] !== nextCharacter/,
);
assert.match(
  editor,
  /\.delete\(\$from\.pos - previousCharacter\.length, \$from\.pos \+ nextCharacter\.length\)/,
);
assert.match(
  editor,
  /compositionend\(view, event\)[\s\S]*?markdownPairedSymbols\[openingSymbol\]/,
);
assert.match(
  editor,
  /previousCharacter !== openingSymbol \|\|[\s\S]*?nextCharacter === closingSymbol/,
);
assert.match(
  editor,
  /insertText\(closingSymbol, \$from\.pos\)[\s\S]*?TextSelection\.create\(tr\.doc, \$from\.pos\)/,
);
assert.match(
  editor,
  /handleKeyDown\(view, event\) \{[\s\S]*?event\.isComposing \|\|[\s\S]*?imeCompositionActiveRef\.current/,
);
assert.match(
  editor,
  /completedInlineMarkdownLinkBeforeClosingParenthesis\(\n\s*view\.state,\n\s*\$from\.pos,\n\s*\)/,
);
assert.match(
  editor,
  /function completedInlineMarkdownLinkBeforeClosingParenthesis\([\s\S]*?nextCharacter !== "\)"[\s\S]*?inlineMarkdownLinkPattern/,
);
assert.match(
  editor,
  /appendTransaction\(transactions, oldState, newState\) \{[\s\S]*?transaction\.docChanged[\s\S]*?transaction\.selectionSet[\s\S]*?oldState\.selection\.eq\(newState\.selection\)/,
);
assert.match(
  editor,
  /const selectionStayedInsideLink =[\s\S]*?newState\.selection\.from >= completedLink\.linkStart[\s\S]*?newState\.selection\.to < completedLink\.end;/,
);
assert.match(
  editor,
  /if \(selectionStayedInsideLink\) return null;[\s\S]*?createInlineMarkdownLinkTransaction\(\n\s*newState,/,
);
assert.match(
  editor,
  /createInlineMarkdownLinkInputRule\(\),\n\s*createPastedLinkBoundaryPlugin\(\),\n\s*createPairedSymbolPlugin\(\),/,
);

console.log("milkdown paired symbols regression: PASS");

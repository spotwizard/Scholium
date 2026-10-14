import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const translations = readFileSync(new URL("../src/i18n.ts", import.meta.url), "utf8");

assert.match(
  appSource,
  /const floatingCopyActionKey = activeNote[\s\S]*?activeGlossaryTerm[\s\S]*?floating-glossary:/,
);
assert.match(
  appSource,
  /const floatingCopyContent = activeNote\?\.body \?\? activeGlossaryTerm\?\.definition/,
);
assert.match(
  appSource,
  /\{floatingCopyActionKey \? \([\s\S]*?className=\{`floating-note-copy-button[\s\S]*?copyTextContent\(floatingCopyContent, floatingCopyActionKey\)/,
);
assert.match(translations, /"glossary\.copy": "複製名詞解釋"/);
assert.match(translations, /"glossary\.copy": "Copy term definition"/);
assert.match(translations, /"glossary\.copy": "复制名词解释"/);

console.log("floating glossary copy regression: PASS");

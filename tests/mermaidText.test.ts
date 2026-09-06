import assert from "node:assert/strict";
import test from "node:test";
import mermaid from "mermaid";
import type { FlowDB } from "mermaid/dist/diagrams/flowchart/flowDb.js";
import { flowTextRanges, registerFlowTextParser, replaceDiagramText, restoredFlowText } from "../src/mermaidText.ts";

mermaid.initialize({ startOnLoad: false });
const diagram = await mermaid.mermaidAPI.getDiagramFromText("flowchart TD\nA-->B");
registerFlowTextParser(diagram.parser);

test("restored metadata text follows Mermaid quoting and escaping without changing the active diagram", () => {
  const original = [...(diagram.db as FlowDB).getVertices().keys()];
  for (const [label, expected] of [["'原來的文字'", "原來的文字"], ["'It''s original'", "It's original"], ['"line\\nnext"', "line\nnext"]]) {
    assert.equal(restoredFlowText(`flowchart TD\nA@{ label: ${label} }`).get("node:A"), expected);
  }
  assert.deepEqual([...(diagram.db as FlowDB).getVertices().keys()], original);
});

test("edit the last declared label without rewriting IDs, relationships, comments or other labels", () => {
  const source = 'flowchart TD\n%% A["comment"]\nA["Old"] --> B["Old"]\nA["Current"]\nstyle A fill:red\n';
  const ranges = flowTextRanges(source, ["A", "B"], []);
  const first = replaceDiagramText(source, ranges, "node:A", '新的 "名稱" & <內容> #1\n第二行');
  assert.equal(first.source, source.replace('A["Current"]', 'A["新的 #34;名稱#34; #38; #60;內容#62; #35;1<br/>第二行"]'));
  const second = replaceDiagramText(first.source, first.ranges, "node:B", "另一個地點");
  assert.equal(second.source, first.source.replace('B["Old"]', 'B["另一個地點"]'));
});

test("preserve each existing node shape while replacing only its text", () => {
  for (const [open, close] of [["[", "]"], ["(", ")"], ["((", "))"], ["(((", ")))"], ["([", "])"],
    ["[[", "]]"], ["[(", ")]"], ["{", "}"], ["{{", "}}"], [">", "]"], ["[/", "/]"], ["[\\", "\\]"]]) {
    const source = `flowchart TD\nA${open}original${close}`;
    const changed = replaceDiagramText(source, flowTextRanges(source, ["A"], []), "node:A", "New");
    assert.equal(changed.source, `flowchart TD\nA${open}"New"${close}`, `${open} ${close}`);
  }
});

test("bare nodes gain a display label without renaming the identity or adding duplicate definitions", () => {
  const source = "flowchart TD\nA --> B\nB --> A";
  const first = replaceDiagramText(source, flowTextRanges(source, ["A", "B"], []), "node:B", "Display");
  assert.equal(first.source, 'flowchart TD\nA --> B["Display"]\nB --> A');
  const second = replaceDiagramText(first.source, first.ranges, "node:B", "Updated");
  assert.equal(second.source, 'flowchart TD\nA --> B["Updated"]\nB --> A');
});

test("group titles and duplicate node names map to their own exact source ranges", () => {
  const source = 'flowchart TD\nsubgraph Group ["Same"]\n A["Same"] --> B\nend';
  const ranges = flowTextRanges(source, ["A", "B"], ["Group"]);
  const changed = replaceDiagramText(source, ranges, "group:Group", "Group title");
  assert.equal(changed.source, source.replace('["Same"]', '["Group title"]'));
  assert.equal(replaceDiagramText(changed.source, changed.ranges, "node:A", "Node title").source,
    'flowchart TD\nsubgraph Group ["Group title"]\n A["Node title"] --> B\nend');
  assert.throws(() => replaceDiagramText(source, ranges, "node:missing", "x"), /unavailable/);
});

test("metadata labels edit in place and keep the shape properties", () => {
  const source = 'flowchart TD\nA@{ shape: rect, label: "First" } --> B@{ shape: circle }';
  const first = replaceDiagramText(source, flowTextRanges(source, ["A", "B"], []), "node:A", "Changed");
  assert.equal(first.source, source.replace('label: "First"', 'label: "Changed"'));
  const second = replaceDiagramText(first.source, first.ranges, "node:B", "Named");
  assert.equal(second.source, first.source.replace('B@{', 'B@{ label: "Named",'));
});

test("configuration, line endings and intentional label whitespace survive text edits", () => {
  const source = '---\r\nconfig:\r\n  theme: base\r\n---\r\nflowchart TD\r\nA["before"] --> B\r\n';
  const result = replaceDiagramText(source, flowTextRanges(source, ["A", "B"], []), "node:A", "  after\t");
  assert.equal(result.source, source.replace('"before"', '"#32;#32;after#9;"'));
});

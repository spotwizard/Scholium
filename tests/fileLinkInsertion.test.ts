import assert from "node:assert/strict";
import {
  fileLinkTriggerHasBoundary,
  filterFileLinkCandidates,
  isMarkdownFilePath,
  siblingFileLinkHref,
  sourceMarkdownFileLink,
} from "../src/fileLinkInsertion.ts";
import { resolveMarkdownLinkTarget } from "../src/markdownLinkTarget.ts";

assert.equal(siblingFileLinkHref("會議紀錄.md"), "會議紀錄.md");
assert.equal(siblingFileLinkHref("my notes (v2)#1?.md"), "my%20notes%20%28v2%29%231%3F.md");
assert.equal(siblingFileLinkHref("100%.md"), "100%25.md");

for (const fileName of ["my notes (v2)#1?.md", "100%20 done.md", "會議 紀錄.md"]) {
  assert.deepEqual(
    resolveMarkdownLinkTarget(siblingFileLinkHref(fileName), "/notes/current.md", "local"),
    { kind: "document", path: `/notes/${fileName}` },
  );
  assert.deepEqual(
    resolveMarkdownLinkTarget(siblingFileLinkHref(fileName), "/Apps/notes/current.md", "dropbox"),
    { kind: "document", path: `/Apps/notes/${fileName}` },
  );
}

assert.equal(sourceMarkdownFileLink("年度 [草稿]", "a.md"), "[年度 \\[草稿\\]](a.md)");

assert.equal(fileLinkTriggerHasBoundary(""), true);
assert.equal(fileLinkTriggerHasBoundary("請參考 "), true);
assert.equal(fileLinkTriggerHasBoundary("name"), false);
assert.equal(fileLinkTriggerHasBoundary("依"), false);

const files = [
  { fileName: "Budget.md", path: "/n/Budget.md", title: "Budget" },
  { fileName: "會議紀錄.md", path: "/n/會議紀錄.md", title: "會議紀錄" },
];
assert.deepEqual(filterFileLinkCandidates(files, ""), files);
assert.deepEqual(filterFileLinkCandidates(files, " bud "), [files[0]]);
assert.deepEqual(filterFileLinkCandidates(files, "會議"), [files[1]]);

assert.equal(isMarkdownFilePath("/n/會議.MD"), true);
assert.equal(isMarkdownFilePath("/n/report.pdf"), false);
assert.equal(isMarkdownFilePath("/n/a.md.notes.json"), false);

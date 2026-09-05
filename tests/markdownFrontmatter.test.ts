import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  frontmatterBodyOffsetFromFullSourceOffset,
  fullSourceOffsetFromFrontmatterBodyOffset,
  markdownTagDedupeKey,
  mergeMarkdownFrontmatter,
  normalizeMarkdownTag,
  readMarkdownTags,
  splitMarkdownFrontmatter,
  writeMarkdownTags,
} from "../src/markdownFrontmatter.ts";

test("tag normalization and dedupe keys share one whitespace and case rule", () => {
  assert.equal(normalizeMarkdownTag("  台北\t 美食\n"), "台北 美食");
  assert.equal(normalizeMarkdownTag(" \t\n"), "");
  assert.equal(markdownTagDedupeKey("  TrAvEl  "), "travel");
});

type FrontmatterTagFixture = {
  name: string;
  markdown: string;
  tags: string[];
};

const tagFixtures = JSON.parse(
  readFileSync(new URL("./fixtures/frontmatter-tags.json", import.meta.url), "utf8"),
) as FrontmatterTagFixture[];

test("frontend and backend share the frontmatter tag fixtures", () => {
  tagFixtures.forEach((fixture) => {
    assert.deepEqual(readMarkdownTags(fixture.markdown), fixture.tags, fixture.name);
  });
});

test("writing tags preserves the frontmatter body and replaces legacy tag syntax", () => {
  const source = "---\ntitle: 台北\ntags : [舊標籤]\n---\n\n第一行\n第二行";
  const next = writeMarkdownTags(source, ["新標籤", "emoji 😀"]);

  assert.equal(next, "---\ntitle: 台北\ntags:\n  - 新標籤\n  - emoji 😀\n---\n\n第一行\n第二行");
  assert.equal(splitMarkdownFrontmatter(next)?.body, "第一行\n第二行");
  assert.deepEqual(readMarkdownTags(next), ["新標籤", "emoji 😀"]);
});

test("removing the only frontmatter field returns the original body", () => {
  assert.equal(writeMarkdownTags("---\ntags: [旅行]\n---\n內容", []), "內容");
});

test("frontmatter body offsets and merge preserve the editor source boundary", () => {
  const source = "---\ntitle: 測試\n---\n\n甲😀é乙";
  const split = splitMarkdownFrontmatter(source);

  assert.ok(split);
  assert.equal(fullSourceOffsetFromFrontmatterBodyOffset(source, 3), split.bodyStart + 3);
  assert.equal(mergeMarkdownFrontmatter(source, "更新內容"), `${split.frontmatter}更新內容`);
});

test("CRLF frontmatter body offsets map back to the original source", () => {
  const source = "---\r\ntitle: 測試\r\n---\r\n\r\n甲\r\n😀é乙";
  const normalizedBody = splitMarkdownFrontmatter(source)?.body;
  const sourceBodyStart = source.indexOf("甲");

  assert.equal(normalizedBody, "甲\n😀é乙");
  for (const bodyOffset of [0, 1, 2, 4, 6, normalizedBody.length]) {
    const sourceOffset = fullSourceOffsetFromFrontmatterBodyOffset(source, bodyOffset);
    assert.equal(frontmatterBodyOffsetFromFullSourceOffset(source, sourceOffset), bodyOffset);
    assert.equal(
      source.slice(sourceBodyStart, sourceOffset).replace(/\r\n/g, "\n"),
      normalizedBody.slice(0, bodyOffset),
      `body offset ${bodyOffset}`,
    );
  }
});

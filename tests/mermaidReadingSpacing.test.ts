import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("diagram spacing outranks the editor reset regardless of stylesheet load order", () => {
  const css = readFileSync(new URL("../src/mermaidReading.css", import.meta.url), "utf8");
  // Milkdown resets every descendant with one class (.milkdown *). Every rule
  // defining diagram margins or padding needs the component scope as well.
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, declarations] = match;
    if (!/\b(?:margin|padding)(?:-\w+)?\s*:/.test(declarations)) continue;
    if (!selector.includes("reading-diagram__")) continue;
    const classes = selector.match(/\.[\w-]+/g) ?? [];
    assert.ok(classes.length >= 2, `spacing must outrank .milkdown *: ${selector.trim()}`);
  }
  assert.match(css, /\.reading-diagram \.reading-diagram__group\s*\{[^}]*padding: 20px 0 48px/);
  assert.match(css, /\.reading-diagram \.reading-diagram__group-title\s*\{[^}]*margin: 0 0 24px/);
  // The title belongs more closely to its own nodes than to the previous group.
  const groupSpacing = css.match(/\.reading-diagram \.reading-diagram__group\s*\{[^}]*padding: (\d+)px 0 (\d+)px/)!;
  const headingSpacing = css.match(/\.reading-diagram \.reading-diagram__group-title\s*\{[^}]*margin: 0 0 (\d+)px/)!;
  assert.ok(Number(headingSpacing[1]) < Number(groupSpacing[1]) + Number(groupSpacing[2]));
});

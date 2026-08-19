import assert from "node:assert/strict";
import test from "node:test";

test("concurrent Mermaid loads share one initialization", async () => {
  const { default: mermaid } = await import("mermaid");
  const originalInitialize = mermaid.initialize;
  let initializeCalls = 0;

  mermaid.initialize = () => {
    initializeCalls += 1;
  };

  try {
    const { loadScholiumMermaid } = await import("../src/mermaid.ts");
    const loaded = await Promise.all([
      loadScholiumMermaid(),
      loadScholiumMermaid(),
      loadScholiumMermaid(),
    ]);

    assert.equal(initializeCalls, 1);
    assert.ok(loaded.every((instance) => instance === mermaid));
  } finally {
    mermaid.initialize = originalInitialize;
  }
});

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

test("Milkdown Mermaid preview render preserves reader scroll position and protects user scrolling", async () => {
  const { readFileSync } = await import("node:fs");
  const editor = readFileSync(new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url), "utf8");

  assert.match(
    editor,
    /function elementCanScrollVertically\(element: HTMLElement\) \{[\s\S]*?overflowY !== "visible"[\s\S]*?overflowY !== "clip"[\s\S]*?element\.scrollHeight > element\.clientHeight \+ 1/,
  );
  assert.match(
    editor,
    /function resolveEditorScrollContainer\(target: HTMLElement \| null\): Element \| null \{[\s\S]*?elementCanScrollVertically\(current\)[\s\S]*?return typeof document !== "undefined" \? document\.scrollingElement : null;/,
  );
  assert.match(
    editor,
    /userHasScrolledRef = useRef\(false\);/,
  );
  assert.match(
    editor,
    /lastUserScrollTimeRef = useRef\(0\);/,
  );
  assert.match(
    editor,
    /window\.addEventListener\("wheel", markUserScrolled/,
  );
  assert.match(
    editor,
    /window\.addEventListener\("touchmove", markUserScrolled/,
  );

  // 確保絕對不含有主動將 deltaHeight 累加至 scrollTop 造成自動向下跳滾的有害程式碼
  assert.doesNotMatch(
    editor,
    /snapshot\.scrollContainer\.scrollTop \+= deltaHeight;/,
  );
  assert.doesNotMatch(
    editor,
    /restoreMermaidPreviewScrollSnapshot/,
  );

  // 確保關閉了 CodeMirrorBlock 的 5 秒 offscreen teardown，避免圖表離開視區上方後高度坍塌造成畫面下跳
  assert.match(
    editor,
    /import\s*\{[^}]*CodeMirrorBlock[^}]*\}\s*from\s*["']@milkdown\/kit\/component\/code-block["']/,
  );
  assert.match(
    editor,
    /CodeMirrorBlock\.prototype[\s\S]*?proto\.scheduleTeardown = \(\) => \{\};[\s\S]*?proto\.teardownCodeMirror = \(\) => \{\};/,
  );
});

test("CodeMirrorBlock offscreen teardown can be safely disabled", async () => {
  const { CodeMirrorBlock } = await import("@milkdown/kit/component/code-block");
  assert.ok(CodeMirrorBlock);

  // 驗證原型鏈上可安全配置為 no-op，絕不觸發任何破壞性 DOM 卸載
  const proto = CodeMirrorBlock.prototype as unknown as {
    scheduleTeardown?: () => void;
    teardownCodeMirror?: () => void;
  };
  proto.scheduleTeardown = () => {};
  proto.teardownCodeMirror = () => {};

  const blockInstance = Object.create(CodeMirrorBlock.prototype);
  assert.doesNotThrow(() => {
    blockInstance.scheduleTeardown();
    blockInstance.teardownCodeMirror();
  });
});

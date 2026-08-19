import assert from "node:assert/strict";
import { translate, type AppLanguage, type TranslationKey } from "../src/i18n.ts";
import { localRecoveryErrorTranslationKey } from "../src/localRecoveryError.ts";

assert.equal(
  localRecoveryErrorTranslationKey("local document recovery conflict"),
  "error.localRecoveryConflict",
);
assert.equal(
  localRecoveryErrorTranslationKey(
    new Error("local document recovery manifest is invalid"),
  ),
  "error.localRecoveryManifestInvalid",
);
assert.equal(
  localRecoveryErrorTranslationKey(
    "save failed: local document recovery conflict at /Users/private/secret.md: secret content",
  ),
  "error.localRecoveryConflict",
);
assert.equal(
  localRecoveryErrorTranslationKey({
    message:
      "open failed: local document recovery manifest is invalid at /Users/private/secret.md",
  }),
  "error.localRecoveryManifestInvalid",
);
assert.equal(localRecoveryErrorTranslationKey("unrelated failure"), null);
assert.equal(localRecoveryErrorTranslationKey(null), null);

const expected: Record<
  AppLanguage,
  Record<Extract<TranslationKey, `error.localRecovery${string}`>, string>
> = {
  "zh-Hant": {
    "error.localRecoveryConflict":
      "偵測到尚待處理的本機復原內容。為避免覆蓋變更，Scholium 已停止這次操作；目前無法在 App 內自動解除，請先保留並備份原始 Markdown 檔案。",
    "error.localRecoveryManifestInvalid":
      "本機復原資料損壞或無法讀取。為保護檔案，Scholium 已停止這次操作；重新開啟不會自動修復，請先保留並備份原始 Markdown 檔案。",
  },
  en: {
    "error.localRecoveryConflict":
      "Pending local recovery data was found. Scholium stopped this action to avoid overwriting changes. The app cannot resolve it automatically yet; keep and back up the original Markdown file.",
    "error.localRecoveryManifestInvalid":
      "The local recovery data is damaged or unreadable. Scholium stopped this action to protect the file. Reopening will not repair it automatically; keep and back up the original Markdown file.",
  },
  "zh-Hans": {
    "error.localRecoveryConflict":
      "检测到尚待处理的本地恢复内容。为避免覆盖更改，Scholium 已停止本次操作；目前无法在 App 内自动解除，请先保留并备份原始 Markdown 文件。",
    "error.localRecoveryManifestInvalid":
      "本地恢复数据已损坏或无法读取。为保护文件，Scholium 已停止本次操作；重新打开不会自动修复，请先保留并备份原始 Markdown 文件。",
  },
};

Object.entries(expected).forEach(([language, messages]) => {
  Object.entries(messages).forEach(([key, message]) => {
    const translated = translate(language as AppLanguage, key as TranslationKey);
    assert.equal(translated, message);
    assert.doesNotMatch(
      translated,
      /local document recovery|manifest|\/Users\/private|secret content/i,
      `${language} ${key} must not expose recovery internals`,
    );
  });
});

console.log("local recovery error normalization: PASS");

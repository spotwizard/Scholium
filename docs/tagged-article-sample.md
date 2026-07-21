---
title: Scholium tag feature sample
tags:
  - 閱讀
  - AI
  - paper
---

# 用標籤整理一篇 AI 論文筆記

這是一篇用來測試 Scholium 標籤功能的範文。檔案最上方的 YAML frontmatter 直接寫入 `tags:`，因此用其他支援 Markdown frontmatter 的軟體打開時，也能看到相同的標籤資料。

## 閱讀目的

這篇筆記假設使用者正在閱讀一篇和 AI paper 有關的文章，並希望用標籤把它放進「閱讀」、「AI」與「paper」三個分類。這些標籤應該由 Scholium 顯示成文件上方的 tag chips；新增或刪除 tag 時，只更新 frontmatter，不應改寫正文段落。

## 摘要

文章主要討論一個模型如何從大量文本中學習模式，並在推論階段根據上下文產生答案。閱讀時可以把重要句子加上 selection note，另把專有名詞加入 glossary，但這些筆記和名詞資料仍然保存在 Scholium 的 sidecar notes store，不會寫入本文。

## 測試重點

- 打開檔案後，Scholium 應讀到 `閱讀`、`AI`、`paper` 三個標籤。
- 新增標籤時，應加入到 frontmatter 的 `tags:` 清單。
- 刪除所有標籤後，若 frontmatter 沒有其他欄位，才可移除 frontmatter；本範文有 `title`，所以刪除標籤後仍應保留 `title`。
- 編輯正文時，既有標籤不應消失。
- 新增 selection note 或 glossary 時，不應把筆記內容寫回這份 Markdown。


# Scholium

Scholium 是一個 macOS Markdown 閱讀與寫作 app，讓使用者在閱讀或編輯 Markdown 時，把筆記綁在選取的文字範圍上。

Scholium 是 local-first desktop app。Markdown 內容會存回原始 `.md` 檔，selection notes 會存在同資料夾的 sidecar file，不會寫進 Markdown 內文。

## 目前功能

- 開啟單一 Markdown 檔案
- 開啟資料夾並瀏覽其中的 Markdown 檔案與子資料夾
- 在 Preview mode 閱讀 Markdown
- 在 Edit mode 編輯 Markdown 原始內容
- 在 preview 中直接編輯單一 Markdown block
- 選取完整句子或段落後建立 note
- 點選標記文字查看、編輯或刪除 note
- 自動儲存 Markdown 內容與 notes
- 重新啟動 app 時還原上次開啟的 Markdown 檔案
- 從 macOS File menu 開啟常用目錄與最近開啟項目

## 資料儲存

Scholium 不會把 notes 寫進 Markdown 內文。每個 Markdown 檔案會有一個相鄰的 notes file：

```text
article.md
article.md.notes.json
```

刪除的 notes 會從下一次儲存後的 notes file 中排除。

## 基本操作

macOS File menu 提供：

- `File > 新增檔案`
- `File > 開啟檔案`
- `File > 開啟目錄`
- `File > 常用目錄`
- `File > 最近開啟`

鍵盤操作：

- `Cmd+/`：切換 Preview mode 與 Edit mode
- `Escape`：關閉目前的 note panel
- Note editor 內按 `Enter`：回到閱覽狀態
- Note editor 內按 `Shift+Enter`：換行

## 文件

- 開發說明：[docs/development.md](docs/development.md)

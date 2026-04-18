# suNmerandone.github.io

個人作品集 / Personal portfolio — AI 內容工具設計與實驗紀錄。

Live: <https://sunmerandone.github.io/>

## 結構

```
.
├── index.html                          # 繁中 landing（Works + Resume 兩段）
├── en/index.html                       # EN landing（同構）
├── claude-devkit-guide/
│   ├── index.html                      # ZH · 技術報告
│   └── en/index.html                   # EN
├── claude-present-showcase/
│   ├── index.html                      # ZH · scroll showcase
│   └── en/index.html                   # EN
├── resume/
│   ├── index.html                      # ZH resume（private 版移除 email 等 .private-only 元素後）
│   └── en/index.html                   # EN resume
└── .nojekyll                           # 停用 Jekyll 處理
```

**路徑慣例**：

- 每份作品 `{slug}/index.html` 為 ZH 主版、`{slug}/en/index.html` 為 EN 翻譯版
- 每頁右上角放語言切換連結
- `resume/` 是特殊類別（顯示在 landing 的 Resume 區段，採 utility-link 設計而非 work card）

## Landing 的 Markers（自動重生用）

兩份 landing 內部有 HTML comment markers，被 `promote-to-showcase` skill 用來自動重生索引：

```html
<!-- WORK_CARDS_START -->
...work cards here, auto-regenerated...
<!-- WORK_CARDS_END -->

<section class="resume">
  <h2>Resume</h2>
  <!-- RESUME_CARDS_START -->
  ...resume utility links, auto-regenerated...
  <!-- RESUME_CARDS_END -->
</section>
```

**Skill 只重寫 markers 之間**，markers 以外的 HTML（hero、footer、CSS、language toggle）是手寫的不動。

## 這個 repo 不做什麼

- **不是**作品本身的源碼倉（source 在各 private repo）
- **不**追蹤作品的迭代歷史（只放當下要公開的版本）
- **不**放任何私人資料 —— 履歷草稿、source-notes、generation-log、LinkedIn snapshot 等都留在 [`claude-present`](https://github.com/suNmerandone/claude-present) private repo

## 如何加新作品

### 推薦：透過 `promote-to-showcase` skill（自動化）

在 `claude-present` repo 裡：

1. 用 skill 產內容（`technical-report` / `internal-presentation` / `resume-profile`）
2. Review 覺得可以公開 → 說「promote {slug} 到 showcase」
3. `promote-to-showcase` skill 自動：
   - 套 privacy transformation（移除 `.private-only` 元素、internal sync-marker comments、resume 的 email）
   - 複製檔案到本 repo 對應路徑
   - 重生 landing 的 Works / Resume 區塊
   - 自動 commit + push

詳見 `claude-present` 內的 [`docs/how-to-iterate.md`](https://github.com/suNmerandone/claude-present/blob/main/docs/how-to-iterate.md)。

### 手動 fallback

若不走 skill：

1. 手動複製 HTML 到 `{slug}/index.html`（必要時 `en/`）
2. 移除任何 `.private-only` 元素與 `<!-- sync-marker -->` 等 internal markers
3. 在兩份 landing 的 `WORK_CARDS_START/END` 區塊之間加 card
4. commit + push → GitHub Pages 自動部署（約 30–60 秒）

## Design system

CSS tokens 與 pattern 與 [`claude-present`](https://github.com/suNmerandone/claude-present/tree/main/design-system) 一致，確保作品視覺語言跨站統一。本 repo **不複製 design-system/**，每份 HTML 檔是獨立 inline CSS（部署簡單、不需要 build step）。

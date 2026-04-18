# suNmerandone.github.io

個人作品集 / Personal portfolio — AI 內容工具設計與實驗紀錄。

Live: https://sunmerandone.github.io/

## 結構

```
.
├── index.html                          # 繁中 landing
├── en/index.html                       # EN landing
├── claude-devkit-guide/index.html      # Deep-dive guide (ZH)
└── ...
```

每份作品採「資料夾即路由」：`{slug}/index.html` 為繁中主版，`{slug}/en/index.html` 為英文翻譯版（視情況逐步補上）。每頁右上角放語言切換連結。

## 這個 repo 不做什麼

- **不是**作品本身的源碼倉（那些留在各自的 private repo）
- **不**追蹤迭代歷史（只推經我確認可公開的版本）
- **不**放任何私人資料（履歷草稿、source notes、職涯原始資料皆留在 `claude-present` private repo）

## 如何加新作品

1. 在 private workspace（如 `claude-present`）產出 → 自我檢查 → 確認要公開
2. 複製僅需公開的 HTML 檔到 `{slug}/index.html`
3. （可選）翻譯成 EN 版放 `{slug}/en/index.html`
4. 更新兩份 landing 的作品清單
5. commit + push；GitHub Pages 自動部署

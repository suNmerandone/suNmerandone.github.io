# Coast FIRE MC — public bundle

此資料夾為自動生成的靜態 bundle，**不要手動編輯**，來源是私人 repo 的
`tools/build_public.js`。

來源 commit 時間：2026-04-24T09:08:34.022Z
包含內容：
- `index.html`        根部重導至 `web/`
- `web/`              UI 入口（含 Web Worker、uPlot vendored）
- `lib/core.mjs`      模擬核心
- `robots.txt`        禁止所有搜尋引擎爬蟲

部署：
- 把整個資料夾放到任何靜態主機即可
- 無 build step、無 runtime 依賴
- 檔案都用相對路徑，放在任意 subpath 都能運作

隱私保護措施：
- HTML 已加 `<meta name="robots" content="noindex, nofollow, noarchive">`
- `robots.txt` Disallow 全站
- footer 已移除指向 private repo 的連結
- `referrer` 設為 no-referrer（避免連結外部時洩漏來源）

原始碼保留於私人 repo，此處僅為執行用 bundle。

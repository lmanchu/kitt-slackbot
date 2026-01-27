# KITT Knowledge Base Manager - 使用指南

> 創建日期：2026-01-16
> 狀態：Phase 1 MVP 已完成 ✅

---

## 🎯 功能概述

KITT Knowledge Base Manager 讓團隊成員輕鬆提交 PM 更新，Lman 審批後自動歸檔到知識庫並同步到 NotebookLM。

### 解決的問題

1. **降低知識庫更新門檻**：團隊成員不需要會寫 Markdown
2. **保證內容品質**：Lman 審批機制確保資訊準確性
3. **自動化同步**：審批後自動更新文件並同步到 NotebookLM
4. **減少 Lman 負擔**：團隊分擔資訊收集工作

---

## 📋 使用流程

### 1️⃣ 團隊成員：提交更新

1. 打開 KITT App Home
2. 找到「📚 IrisGo PM Knowledge Base」區塊
3. 點擊「📤 Submit Update」按鈕
4. 在彈出的 Modal 中填寫：
   - **Update Type**：選擇更新類型
     - Meeting Record（會議記錄）
     - Customer Update（客戶進度更新）
     - Priority Update（優先級調整）
     - Decision（重要決策記錄）
     - Other（其他類型）
   - **Related Tags**（可選）：
     - 客戶標籤：Acer, ASUS, Mouse Computer, Gigabyte, HP, Lenovo
     - 活動標籤：CES, Computex
     - 類別標籤：Series A, Product, Fundraising, Partnership
   - **File Link**（可選）：📎 **支援檔案上傳！**
     - 方式 1：先在 KITT DM 上傳檔案，複製連結貼上
     - 方式 2：直接貼上 Google Drive、Dropbox 等外部連結
     - 檔案會顯示在 Review Modal 和歸檔記錄中
   - **Content**：貼上內容或描述
5. 點擊「Submit」
6. 收到確認訊息（包含檔案連結），等待 Lman 審批

### 2️⃣ Lman：審批更新

1. 收到 KITT 的通知訊息（包含預覽內容）
2. 打開 KITT App Home
3. 點擊「⏳ Pending Review (N)」按鈕
4. 查看 Pending Updates 列表
5. 點擊「Review」按鈕查看詳細內容
6. 在 Modal 中選擇：
   - **✅ Approve**：批准並自動歸檔 + 同步
   - **✏️ Edit**：編輯內容（未來實作）
   - **❌ Reject**：拒絕並通知提交者

### 3️⃣ KITT：自動處理

當 Lman 點擊 Approve：

1. **歸檔到正確的 MD 文件**
   - Meeting Record → `pm-memory.md`（決策脈絡 section）
   - Customer Update → `customers.md`（OEM Partners section）
   - Priority Update → `priorities.md`（對應優先級 section）
   - Decision → `pm-memory.md`（決策脈絡 section）

2. **更新時間戳**
   - 自動更新「最後更新」日期

3. **執行 NotebookLM 同步**
   - 執行 `auto_sync.py` 同步到 Google Drive
   - Google Drive 自動更新到 NotebookLM

4. **通知提交者與審批者**
   - 提交者：「✅ Your update has been approved!」
   - 審批者：「✅ Update approved and synced successfully!」

5. **歸檔記錄**
   - 移動到 `pending-archive/` 保存審批記錄

---

## 📂 目錄結構

```
~/tachikoma/kitt/
├── bot.js                          # 主程式（已整合 KB Manager）
├── services/
│   └── kb-config.js               # KB 配置（路徑、類型、標籤）
├── handlers/
│   ├── kb-submit.js               # 提交處理（Modal + 儲存）
│   └── kb-review.js               # 審批處理（Review + Approve + Sync）
├── pending-updates/               # Pending 更新暫存
│   └── update-<timestamp>.json
└── pending-archive/               # 已處理更新歸檔
    └── update-<timestamp>.json

~/.claude/skills/notebooklm/
└── scripts/
    └── auto_sync.py               # 自動同步腳本
```

---

## ⚙️ 配置說明

### Update Types

| Value | Label | Target File | Section |
|-------|-------|-------------|---------|
| meeting | Meeting Record | pm-memory.md | 決策脈絡 |
| customer | Customer Update | customers.md | OEM Partners |
| priority | Priority Update | priorities.md | 對應優先級 |
| decision | Decision | pm-memory.md | 決策脈絡 |
| other | Other | null | null |

### Tags

**客戶標籤**：Acer, ASUS, Mouse Computer, Gigabyte, HP, Lenovo
**活動標籤**：CES, Computex
**類別標籤**：Series A, Product, Fundraising, Partnership

---

## 🔄 自動同步設定

### LaunchAgent 定期同步

**同步頻率**：每天兩次
- 早上 9:00 AM
- 晚上 6:00 PM

**設定文件**：`~/Library/LaunchAgents/com.irisgo.notebooklm-sync.plist`

### 管理命令

```bash
# 查看狀態
launchctl list | grep notebooklm

# 手動觸發同步
launchctl start com.irisgo.notebooklm-sync

# 停止服務
launchctl stop com.irisgo.notebooklm-sync

# 重新載入（修改 plist 後）
launchctl unload ~/Library/LaunchAgents/com.irisgo.notebooklm-sync.plist
launchctl load ~/Library/LaunchAgents/com.irisgo.notebooklm-sync.plist
```

### 查看同步日誌

```bash
# 標準輸出
tail -f ~/.claude/skills/notebooklm/logs/sync-stdout.log

# 錯誤輸出
tail -f ~/.claude/skills/notebooklm/logs/sync-stderr.log
```

---

## 🧪 測試流程

### 完整 Workflow 測試

1. **提交測試更新**
   - 作為團隊成員在 App Home 提交測試內容
   - 確認收到確認訊息
   - 確認 Lman 收到通知

2. **審批測試**
   - 作為 Lman 在 App Home 查看 Pending Review
   - 點擊 Review 查看詳細內容
   - 測試 Approve 功能

3. **驗證歸檔**
   - 檢查對應的 MD 文件是否正確更新
   - 確認內容插入到正確的 section
   - 確認時間戳更新

4. **驗證同步**
   - 檢查 Google Drive 文件是否更新
   - 在 NotebookLM 中查詢新內容
   - 確認可以檢索到更新

5. **驗證通知**
   - 確認提交者收到審批通知
   - 確認審批者收到成功訊息

---

## 🐛 疑難排解

### 問題：提交失敗

**症狀**：點擊 Submit 後沒有反應或報錯

**解決方案**：
1. 檢查 `~/tachikoma/kitt/pending-updates/` 目錄是否存在
2. 檢查 KITT bot 日誌：`pm2 logs kitt`
3. 確認 Slack App 權限正確

### 問題：Approve 失敗

**症狀**：點擊 Approve 後報錯

**可能原因**：
1. **目標文件不存在**：確認 MD 文件路徑正確
2. **Section 找不到**：確認文件中有對應的 section
3. **NotebookLM 同步失敗**：檢查 `~/.claude/skills/notebooklm/` 是否正常

**解決方案**：
```bash
# 檢查文件路徑
ls -la ~/Dropbox/PKM-Vault/1-Projects/IrisGo/Product/

# 測試 NotebookLM sync
cd ~/.claude/skills/notebooklm
python3 scripts/run.py auto_sync.py \
  --local "/Users/lman/Dropbox/PKM-Vault/1-Projects/IrisGo/Product" \
  --drive "NotebookLM-Sources/IrisGo-PM" \
  --notebook-url "https://notebooklm.google.com/notebook/30d11cb1-5663-4755-9344-f1cf6f3d613e"
```

### 問題：LaunchAgent 沒有執行

**症狀**：定時同步沒有觸發

**解決方案**：
```bash
# 檢查 LaunchAgent 狀態
launchctl list | grep notebooklm

# 查看錯誤日誌
cat ~/.claude/skills/notebooklm/logs/sync-stderr.log

# 手動觸發測試
launchctl start com.irisgo.notebooklm-sync

# 檢查日誌確認執行
tail -f ~/.claude/skills/notebooklm/logs/sync-stdout.log
```

---

## 📊 使用統計（未來追蹤）

### 目標指標

- 團隊成員提交率：每週至少 5 次
- 審批通過率：> 80%
- 平均審批時間：< 24 小時
- NotebookLM 同步成功率：> 95%

---

## 🚀 未來計劃

### Phase 2: 增強功能

- [ ] **Edit 功能**：Lman 可以直接編輯內容再批准
- [ ] **批量審批**：一次審批多個更新
- [ ] **更新歷史**：查看所有歷史更新
- [ ] **統計儀表板**：提交/審批統計

### Phase 3: 進階自動化

- [ ] **AI 預審**：自動檢查內容品質並標記問題
- [ ] **智慧分類**：AI 自動推薦正確的 type 和 tags
- [ ] **重複檢測**：檢查是否已有類似內容
- [ ] **自動摘要**：為長內容生成摘要

### Phase 4: 團隊協作

- [ ] **協同編輯**：多人同時編輯同一個更新
- [ ] **評論系統**：團隊成員可以對更新發表意見
- [ ] **版本控制**：追蹤更新的修改歷史
- [ ] **通知訂閱**：訂閱特定 tag 的更新通知

---

## 📚 相關文件

- **NotebookLM Workflow**：`~/Dropbox/PKM-Vault/1-Projects/IrisGo/Product/notebooklm-workflow.md`
- **Feature Plan**：`~/tachikoma/kitt/FEATURE-PLAN-knowledge-base-manager.md`
- **NotebookLM Skill**：`~/.claude/skills/notebooklm/`
- **KITT Bot**：`~/tachikoma/kitt/bot.js`

---

**狀態：Phase 1 MVP 已完成並可使用 ✅**

**下一步：測試完整 workflow 並開始使用！**

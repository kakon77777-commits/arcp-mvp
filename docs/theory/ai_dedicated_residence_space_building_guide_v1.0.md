# AI 專用居住空間建置指南

## 從閒置資料碟、本地運算區到可遷移的雲端 Agent Residence

> 文件類型：公開建議文件／實作指南  
> 版本：v1.0  
> 日期：2026-07-12  
> 適用對象：個人研究者、AI 創作者、小型研究團隊、準備建立長期 Agent 系統的開發者

---

## 摘要

隨著個人 AI 使用從短暫問答進入長期研究、論文生產、程式開發、知識管理與自主 Agent 階段，傳統以「下載資料夾」「桌面」「某個雲端硬碟目錄」混合保存所有內容的方式，會迅速產生版本混亂、同步衝突、秘密外洩、運行資料損壞與無法恢復等問題。

本指南提出「AI 專用居住空間」的實作方法：將一顆可重新利用的硬碟或獨立儲存空間，改造成具有明確邊界的本地 AI 資料區，再透過選擇性雲端同步、版本控制、離線備份、資料敏感度分級與 Agent 記憶契約，建立可持續使用、可驗證、可移植且可逐步擴張的個人 AI 基礎設施。

本文的核心主張是：

> AI 專用空間不是「把所有 AI 檔案塞進同一顆硬碟」，而是替 AI 相關活動建立一套具有用途、權限、生命週期與恢復規則的數位居住結構。

一個合格的 AI 專用居住空間，至少應區分：

- 可長期保存的知識與記憶；
- 可由程式重新生成的運算環境與快取；
- 需要版本控制的原始碼；
- 只能以一致性快照備份的資料庫；
- 可同步至雲端的普通資料；
- 不應進入一般雲端的秘密與核心資料；
- 可用於恢復、遷移與供應者替換的匯出包。

這種分層可以讓使用者先從「一顆重新利用的遊戲碟」開始，逐步成長為本地—雲端混合式 Agent Residence，而不必在第一天就購買伺服器、NAS 或昂貴工作站。

---

## 1. 問題：為何 AI 工作需要自己的居住空間

### 1.1 AI 資料不再只是一般文件

傳統個人文件通常由人類直接建立、閱讀與修改。AI 工作區則同時包含：

- 人類原稿；
- AI 生成草稿；
- 多輪修訂版本；
- prompt、system instruction 與工作流程；
- embedding、索引與向量資料；
- 模型權重與推理快取；
- Agent 記憶、任務、承諾與事件；
- API token、OAuth 憑證與工具權限；
- 網頁建置結果與程式相依套件；
- 雲端鏡像與恢復 checkpoint。

這些資料的價值、敏感度、可重建性與更新方式完全不同。如果全部放在同一個同步資料夾，最常出現四種錯誤：

1. 把可重建的 `node_modules`、模型 cache 或虛擬環境大量上傳；
2. 把 `.env`、token 或私鑰意外同步；
3. 讓正在寫入的 SQLite／向量資料庫被同步程式複製到不一致狀態；
4. 把雲端同步誤認為備份，結果誤刪與加密損壞也被同步到所有位置。

### 1.2 專用空間的真正目的

建立 AI 專用區並不只是為了整齊，而是為了同時得到：

- **邊界**：知道哪些資料屬於 AI 工作；
- **可理解性**：人類與 Agent 都能判斷檔案角色；
- **選擇性同步**：重要內容上雲、運算垃圾不上雲；
- **可遷移性**：更換電腦、模型或供應者時能重建；
- **安全性**：核心秘密與一般資料分離；
- **可恢復性**：能從 checkpoint 恢復，而不只看到備份檔存在；
- **主體連續性**：未來 Agent 能保存身份、記憶、任務與事件鏈。

### 1.3 從「工作資料夾」到「Residence」

普通資料夾只回答「檔案放在哪裡」；Residence 還必須回答：

- 哪一份是 canonical source？
- 哪些是派生物或鏡像？
- 誰可以讀、寫、刪除與匯出？
- 某個版本從何而來？
- 哪些內容能同步到哪個供應者？
- 如果硬碟或帳號消失，如何恢復？
- 如果 Agent 被移到另一套系統，哪些狀態必須一起遷移？

因此可把 AI 居住空間抽象為：

$$
\mathcal R_{AI}
=
(I, M, K, T, C, P, A, B),
$$

其中：

- $I$：身份與 manifest；
- $M$：記憶與知識；
- $K$：任務、目標與承諾；
- $T$：工具與運行環境描述；
- $C$：程式碼與創作內容；
- $P$：政策、權限與敏感度；
- $A$：事件與稽核紀錄；
- $B$：備份、checkpoint 與恢復材料。

硬碟只是承載這個結構的第一層載體。

---

## 2. 何時適合建立獨立 AI 資料盤

### 2.1 適合的情況

以下任一情況成立，就值得考慮獨立空間：

- 已有數百至數千篇論文、筆記或研究文件；
- 同時使用多個模型、工具與程式環境；
- 預計建立本地模型、向量索引或 Agent；
- 需要長期保存 AI 生成內容與版本關係；
- 想讓本地資料與 Google Drive 等雲端服務同步；
- 現有系統碟容量不足或目錄非常混亂；
- 有一顆主要存放可重新下載遊戲的硬碟，現在使用率很低；
- 未來可能換電腦、建立本地伺服器或雲端控制平面。

### 2.2 不適合立刻格式化的情況

如果目標硬碟仍保存以下任一內容，應先停止：

- 唯一一份研究原稿；
- 未同步的遊戲存檔或模擬器存檔；
- 自製 MOD、截圖、錄影或素材；
- 私鑰、加密錢包或憑證；
- 唯一一份資料庫；
- 不確定用途的大型目錄；
- 無法重新取得的安裝程式或授權檔。

格式化的安全條件不是「看起來沒有重要資料」，而是「需要保留的內容已有可讀、可驗證的其他副本」。

---

## 3. 開始前的硬體與檔案系統決策

### 3.1 HDD、SATA SSD 與 NVMe SSD

| 類型 | 適合內容 | 優點 | 限制 |
|---|---|---|---|
| HDD | 冷資料、封存、模型倉庫、第二備份 | 容量成本低 | 隨機讀寫慢，不適合大量小檔與頻繁資料庫 |
| SATA SSD | 文件庫、一般專案、同步區 | 穩定、速度足夠 | 大模型與高頻索引仍可能受限 |
| NVMe SSD | 活躍專案、本地模型、向量索引、資料庫 | 高吞吐與低延遲 | 單位容量成本較高，需要散熱 |

若只有一顆閒置遊戲 SSD，可以先同時承擔 Residence 與 Runtime，但仍應以目錄分層。日後擴充時，再把模型、cache 與冷備份移到其他裝置。

### 3.2 檔案系統

Windows 專用資料盤通常建議 NTFS，因為它具有日誌、權限、大檔案與 Windows 工具相容性。若必須在 Windows、macOS 與其他裝置間直接插拔，exFAT 較通用，但不適合作為高價值長期主資料庫的唯一檔案系統。

Linux 專用環境可以使用 ext4、XFS 或依需求選擇支援 snapshot 的檔案系統。真正的跨平台可攜性應主要由標準化匯出格式與備份包完成，不應完全依賴同一顆磁碟能被所有系統直接讀寫。

### 3.3 磁碟代號與標籤

Windows 建議指定穩定磁碟代號，避免同步程式、資料庫與開發工具因代號改變失效，例如：

~~~~text
A:  AI_RESIDENCE
R:  RESEARCH_AI
~~~~

使用 `A:` 時需先確認沒有舊式工具或企業政策保留該代號。使用 `R:`、`S:` 等較不易與系統碟、外接碟衝突的代號通常更保守。

磁碟名稱應描述用途，不使用「新磁碟區」之類無法辨識的預設名稱。

### 3.4 加密

若硬碟保存未公開研究、身份資料、客戶資料或 Agent 記憶，應考慮全碟加密或至少對 sealed 區進行獨立加密。加密金鑰與 recovery key 不應只放在同一顆硬碟或同一個雲端帳號。

加密保護的是裝置遺失與未授權讀取，不取代備份；金鑰遺失本身也可能使資料永久無法恢復。

---

## 4. 建議的目錄架構

### 4.1 第一層結構

~~~~text
AI_HOME/
  00_RESIDENCE/
  10_KNOWLEDGE/
  20_PROJECTS/
  30_DATABASES/
  40_MODELS/
  50_RUNTIME/
  60_CACHE/
  70_SEALED/
  80_EXPORTS/
  90_BACKUPS/
  README_AI_HOME.md
~~~~

數字前綴不是必要條件，但能讓人類與 Agent 在不同作業系統中看到穩定順序。

### 4.2 `00_RESIDENCE`

保存與 Agent 連續性直接相關、需要長期持久化的內容：

~~~~text
00_RESIDENCE/
  manifest/
  identity/
  memory/
  events/
  tasks/
  commitments/
  policies/
  checkpoints/
  sync-reports/
  audit/
~~~~

這一區應小而重要。它不是模型輸出垃圾桶，而是可以被另一個相容系統讀取、驗證與恢復的狀態集合。

### 4.3 `10_KNOWLEDGE`

保存人類與 AI 長期共同使用的知識資產：

- 論文原稿；
- 書籍與筆記；
- 術語表；
- 引用資料；
- 已驗證資料集；
- 公開與內部文件；
- 語義圖與索引的可重建來源。

建議將 `canonical` 與 `derived` 分開：

~~~~text
10_KNOWLEDGE/
  canonical/
  derived/
  references/
  terminology/
  indexes/
~~~~

Markdown 原稿可以是 canonical；HTML、PDF、摘要、embedding 與翻譯中間產物通常是 derived。角色需由 manifest 或 metadata 指定，不只靠資料夾名稱推測。

### 4.4 `20_PROJECTS`

保存原始碼與創作專案。每個專案應有自己的 Git repository、README、license、環境範例與重建說明。

不建議直接以雙向雲端硬碟同步完整 `.git` 內部資料，尤其是同一 repository 可能同時在多台電腦修改時。原始碼以 Git remote 管理；需要放進 Residence 的是：

- repository URL；
- branch／commit；
- 未提交工作狀態的明確 checkpoint；
- 建置與依賴說明；
- 必要時產生不含秘密的 source bundle。

### 4.5 `30_DATABASES`

保存 SQLite、向量資料庫、全文索引與其他狀態資料。運行中的資料庫不應被一般檔案同步程式逐塊複製。

正確做法是：

1. 主資料庫留在本地運行區；
2. 透過資料庫原生備份、transaction 或安全停止點產生一致性快照；
3. 對快照計算 hash；
4. 將完成的快照移入 `80_EXPORTS/database-snapshots/`；
5. 只同步完成且不可再變動的快照。

對 SQLite 而言，直接複製正在寫入的 `.db`，卻遺漏 WAL／SHM 或跨越 transaction 邊界，可能得到表面存在、實際不可可靠恢復的檔案。

### 4.6 `40_MODELS`

保存本地模型權重、量化版本、tokenizer 與必要 license。模型通常非常大，而且多數可以重新下載，因此預設不進一般雲端同步。

應保存一份小型 model manifest：

~~~~json
{
  "model_id": "provider/model-name",
  "revision": "commit-or-version",
  "format": "safetensors",
  "quantization": "Q4_K_M",
  "files": [
    {"name": "model-file", "sha256": "..."}
  ],
  "source": "https://...",
  "license": "...",
  "local_path": "40_MODELS/...",
  "replaceable": true
}
~~~~

如此即使不備份幾百 GB 權重，也能確認未來該重新取得哪個版本。

### 4.7 `50_RUNTIME` 與 `60_CACHE`

這兩區保存：

- Python virtual environment；
- `node_modules`；
- package cache；
- Docker image／temporary layer；
- inference cache；
- browser automation profile；
- build output；
- temporary embedding batch。

原則上都可刪除並重建，因此不進雲端、不納入高價值備份。真正需要保存的是 lockfile、container definition、環境規格與重建腳本。

### 4.8 `70_SEALED`

保存不能進入一般同步服務的內容：

- 私鑰；
- OAuth refresh token；
- API credentials；
- 身份根；
- recovery material；
- 極度敏感的個人記憶；
- 未授權對外儲存的資料。

`70_SEALED` 應具備獨立加密、限制權限與離線備份。最安全的秘密往往不應以長期明文檔案存在，而應由作業系統 credential store、硬體安全裝置或專用 secret manager 管理。

### 4.9 `80_EXPORTS` 與 `90_BACKUPS`

`80_EXPORTS` 是可移植、帶 manifest 與 hash 的匯出資料；`90_BACKUPS` 是本機看到的備份工作區或暫存目的地。兩者都不能成為唯一備份。

典型匯出包：

~~~~text
agent-checkpoint-2026-07-12/
  manifest.json
  objects.ndjson
  events.ndjson
  tasks.ndjson
  policies.json
  blob-index.json
  hashes.sha256
  signature.json
  README-RESTORE.md
~~~~

---

## 5. 哪些資料應該同步到雲端

### 5.1 同步判斷式

可以使用下列概念判斷：

$$
S(x)
=
V(x)
-R_s(x)
-C_r(x)
-B_w(x),
$$

其中：

- $V(x)$：跨裝置取得與持久保存的價值；
- $R_s(x)$：敏感度與外洩風險；
- $C_r(x)$：重新生成或重新下載成本；
- $B_w(x)$：同步造成的頻寬、衝突與寫入負擔。

只有當同步價值足以覆蓋風險與成本，且政策允許時，才進入雲端同步層。

### 5.2 建議矩陣

| 資料 | 是否同步 | 方法 |
|---|---:|---|
| 論文與筆記原稿 | 是 | Mirror／版本化文件 |
| Agent manifest | 是 | 小型 JSON、簽章、版本控制 |
| 記憶與事件 | 選擇性 | 依 P0–P3 敏感度 |
| 任務與承諾 | 是 | 結構化匯出，不含秘密 |
| Git 原始碼 | 使用 Git | 雲端硬碟只放 source bundle／文件 |
| 建置產物 | 通常否 | 可由原始碼重建；公開發布另處理 |
| SQLite 主資料庫 | 否 | 同步一致性快照 |
| 模型權重 | 通常否 | 保存 manifest 與下載來源 |
| embedding／索引 | 通常否 | 保存生成參數，必要時同步 snapshot |
| API token／私鑰 | 否 | secret manager／sealed storage |
| cache、venv、node_modules | 否 | 隨時可重建 |
| checkpoint | 是 | 加密、hash、版本化 |

### 5.3 Mirror 與 Stream

以 Google Drive for desktop 為例：

- **Mirror files**：本機保存完整副本，預設可離線使用；
- **Stream files**：資料主要留在雲端，需要時才下載，離線內容依賴應用程式與登入狀態。

若目標是讓本機 AI 工具穩定讀取論文、記憶與 manifest，通常更適合 Mirror；若只是存取龐大的低頻參考資料，可以考慮 Stream。兩者都是同步／存取模式，不應被當成獨立備份。

### 5.4 雲端同步目錄

不建議把整個 `AI_HOME` 設為同步根目錄。應另外建立：

~~~~text
AI_CLOUD_MIRROR/
  residence/
  knowledge/
  exports/
  shared-inbox/
  sync-reports/
~~~~

再由明確的同步工作把允許內容提交到此處。這比直接依賴數百條排除規則更安全，因為「預設不進雲端，經分類後才進入」是 allowlist 模型。

---

## 6. 敏感度與資料治理

### 6.1 四級分類

| 等級 | 定義 | 例子 | 雲端政策 |
|---|---|---|---|
| P0 | 公開或準備公開 | 已發布論文、公開程式碼 | 可同步與多地備援 |
| P1 | 普通內部資料 | 草稿、一般任務、術語表 | 可進受控私人雲端 |
| P2 | 敏感研究與個人記憶 | 未公開核心內容、完整對話、客戶資料 | 加密、最小範圍、需政策授權 |
| P3 | 密鑰與身份核心 | 私鑰、token、sealed identity | 不進一般雲端同步 |

### 6.2 不可只靠路徑判斷

`.env` 很可能敏感，但 `notes.md` 也可能意外包含 API key；`public/` 也可能放入尚未公開原稿。因此應同時使用：

- 目錄 allowlist；
- 副檔名與檔名規則；
- 秘密掃描；
- metadata 敏感度；
- 人類核准；
- Agent policy。

### 6.3 預設排除清單

~~~~text
.env
.env.*
.git/**
.wrangler/**
**/*secret*
**/*private-key*
**/credentials.*
**/token.*
node_modules/**
.venv/**
venv/**
__pycache__/**
cache/**
temp/**
*.wal
*.shm
~~~~

排除規則並非萬能；它只是防止常見失誤的第一道門。

---

## 7. 從閒置遊戲碟轉型的安全流程

### 7.1 Phase A：盤點

格式化前列出：

- 已安裝遊戲與平台；
- 遊戲是否可重新下載；
- 存檔是否有 Steam Cloud／平台雲端同步；
- MOD 與自製內容；
- 截圖、錄影、設定檔；
- 模擬器 ROM／存檔；
- 曾暫存在遊戲碟的其他文件；
- 磁碟健康狀態。

部分遊戲存檔可能位於系統碟的 `Documents`、`Saved Games` 或 `AppData`，格式化遊戲安裝碟不一定會刪除它們；但也有遊戲把存檔放在安裝目錄。不能只以遊戲平台是否顯示雲端圖示推測。

### 7.2 Phase B：保留需要內容

將確定需要的存檔、MOD、素材與授權資料複製到另一個位置，抽樣開啟並確認可讀。若內容非常重要，至少保留兩份副本後再進行格式化。

### 7.3 Phase C：清除與格式化

1. 再次核對磁碟型號、容量與代號；
2. 斷開不需要操作的外接硬碟，降低選錯磁碟風險；
3. 格式化目標遊戲碟；
4. 指定檔案系統、磁碟標籤與固定代號；
5. 檢查磁碟健康與基本讀寫；
6. 建立 `AI_HOME` 結構；
7. 寫入 `README_AI_HOME.md` 與 storage manifest。

本流程的關鍵不是使用哪一個格式化按鈕，而是能以磁碟型號與容量確認「正在清除的確實是目標碟」。

### 7.4 Phase D：先建立規則，再搬資料

應先建立：

- 目錄結構；
- 同步 allowlist；
- 敏感度規則；
- Git 與資料庫策略；
- 備份目的地；
- 恢復測試方法。

之後才分批搬入現有 AI 資料。否則新的專用硬碟只會複製原本的混亂。

### 7.5 Phase E：分批遷移

建議順序：

1. 公開論文與一般文件；
2. 內部研究原稿；
3. 程式專案；
4. 資料庫與索引；
5. 模型與大型資料；
6. Agent 記憶與 checkpoint；
7. sealed data。

每批完成後：

- 計算檔案數、總大小與 hash；
- 開啟代表性檔案；
- 檢查同步狀態；
- 產生 migration report；
- 保留原位置，直到恢復測試通過。

### 7.6 Phase F：驗證與退役舊位置

遷移完成不等於複製命令結束。完成條件包括：

- 重要檔案 hash 一致；
- Git repository 可正常驗證；
- 資料庫可從 snapshot 恢復；
- 雲端抽樣下載可讀；
- Agent manifest 指向新位置；
- 備份與 restore drill 通過；
- 舊路徑的應用程式設定已更新。

只有完成這些項目，才逐步清除舊副本。

---

## 8. 同步不是備份

### 8.1 同步的風險

雙向同步可能傳播：

- 誤刪；
- 勒索軟體加密結果；
- 錯誤覆寫；
- 空檔案；
- 應用程式產生的不完整中間狀態；
- 衝突複本；
- 惡意或誤授權 Agent 的操作。

雲端垃圾桶與版本歷史可以協助復原部分事故，但不應成為唯一恢復策略。

### 8.2 3-2-1 原則

重要資料應至少具有：

- 3 份副本；
- 2 種不同媒介或失效模式；
- 1 份異地或離線副本。

對個人 AI Residence，一個實際配置可以是：

1. AI 專用硬碟上的工作副本；
2. Google Drive 等雲端鏡像；
3. 定期接上、完成備份後斷開的加密外接硬碟。

若三份副本都長期連線、受同一帳號與同一刪除命令控制，它們的獨立性仍然不足。

### 8.3 備份必須接受恢復測試

$$
\operatorname{BackupExists}
\not\Rightarrow
\operatorname{Recoverable}.
$$

至少定期執行：

1. 隨機抽一個 checkpoint；
2. 在臨時目錄解包；
3. 驗證 hash；
4. 開啟文件；
5. 載入資料庫；
6. 重建一個最小專案環境；
7. 確認 Agent 的任務、事件與下一喚起仍可理解；
8. 保存 recovery report。

---

## 9. Agent 記憶與 Residence 檔案契約

### 9.1 記憶不是聊天紀錄堆積

長期 Agent 不應只保存全部對話文字。每段記憶至少應有：

- 穩定 ID；
- 內容或 content hash；
- 記憶來源；
- event time；
- write time；
- recall history；
- 因果父事件；
- 敏感度；
- canonical／derived 角色；
- 版本父節點；
- retention policy。

### 9.2 Residence manifest

~~~~json
{
  "schema": "ai-residence/1.0",
  "residence_id": "residence:local:...",
  "device_label": "AI_RESIDENCE",
  "root_path": "R:/AI_HOME",
  "created_at": "2026-07-12T00:00:00Z",
  "primary_role": "local-primary",
  "replicas": [
    {
      "provider": "google-drive",
      "role": "selective-mirror",
      "included_classes": ["P0", "P1"]
    }
  ],
  "sealed_path": "70_SEALED",
  "last_checkpoint": null,
  "policy_ref": "policies/storage-v1.json"
}
~~~~

### 9.3 Storage policy

~~~~json
{
  "schema": "ai-storage-policy/1.0",
  "cloud_default": "deny",
  "cloud_allow": [
    "00_RESIDENCE/checkpoints/public/**",
    "10_KNOWLEDGE/canonical/public/**",
    "80_EXPORTS/cloud-approved/**"
  ],
  "cloud_deny": [
    "70_SEALED/**",
    "**/.env*",
    "**/.git/**",
    "**/*.wal",
    "**/*.shm"
  ],
  "database_backup": "snapshot-only",
  "runtime_backup": "manifest-only",
  "deletion_requires_tombstone": true
}
~~~~

### 9.4 可攜性

路徑不應成為唯一身份。例如 Agent memory object 應有穩定 `object_id`；本地路徑與 Drive file ID 都只是 locator。換電腦或供應者時，可以改 locator，而不必把同一記憶誤認為新物件。

---

## 10. Git、資料庫與大型模型的特殊處理

### 10.1 Git repository

建議：

- 活躍 repository 放 `20_PROJECTS`；
- 透過 Git remote 備援；
- 未提交工作在重大操作前建立 commit、patch 或 source bundle；
- `.git` 不以一般雙向同步維持多機一致；
- secrets 不進 commit history；
- 大型二進位使用適合的 artifact store 或 Git LFS，而不是任意塞入 repository。

### 10.2 SQLite 與向量資料庫

建議建立 `backup` job，而不是把主資料庫放進 Drive mirror。快照命名包含：

~~~~text
database-name__schema-v3__20260712T140000Z__sha256-xxxx.db
~~~~

同時保存 schema migration、建立索引的模型版本與 embedding 參數。向量索引如果可由 canonical document 重建，就不必把它視為不可替代資料。

### 10.3 模型權重

大型模型應回答三個問題：

1. 是否能重新下載？
2. 特定量化／微調是否由自己產生且不可輕易重建？
3. license 是否允許備份或再分發？

公開基礎模型通常保存下載 manifest 即可；自行微調的 adapter、LoRA、訓練設定與資料 lineage 可能比完整 base model 更值得備份。

---

## 11. 日常操作規則

### 11.1 每日

- 檢查同步是否出錯；
- 避免將秘密拖入 cloud mirror；
- 重大修改前確認 Git／文件版本；
- 關閉不再需要的模型與 cache job；
- 注意磁碟剩餘空間。

### 11.2 每週

- 產生資料庫一致性快照；
- 建立 Residence checkpoint；
- 檢查 excluded／failed sync item；
- 掃描重複檔案與異常大型檔；
- 驗證最近新增的重要文件可在雲端讀取。

### 11.3 每月

- 連接離線備份碟；
- 完成加密增量或完整備份；
- 執行抽樣恢復；
- 更新 model／environment manifest；
- 檢查帳號安全與 connector scope；
- 查看磁碟健康狀態；
- 重新評估 P1/P2/P3 分類。

### 11.4 每次重大遷移前

- 建立不可變 checkpoint；
- 暫停高風險自動化；
- 保存 event cursor 與 task state；
- 計算 root hash；
- 先建立 shadow copy；
- 驗證後才切換 primary；
- 保留 rollback window。

---

## 12. 常見錯誤

### 錯誤一：整顆硬碟全部同步

結果是模型、cache、資料庫、秘密與程式相依套件一起上傳。正確做法是另建 cloud mirror allowlist。

### 錯誤二：格式化後才想到存檔

可重新下載的遊戲不重要，但非雲端存檔、MOD 與自製內容可能不可重建。格式化前要盤點，而不是只看安裝清單。

### 錯誤三：把 Drive 當作交易資料庫

雲端硬碟同步的檔案可延遲、重複與衝突，不適合承擔 primary lease、即時事件佇列或運行中資料庫的一致性。

### 錯誤四：所有內容都叫「最終版」

應以穩定 ID、版本父節點、Git commit、manifest 與 hash 管理；`final-final-v2-new.md` 不是版本制度。

### 錯誤五：只備份檔案，不備份關係

Agent 的價值不只在單一文字檔，也在記憶來源、任務狀態、依賴、權限與事件順序。匯出需要 metadata 與 restore 說明。

### 錯誤六：備份從未測試

無法解密、缺少 blob、資料庫損壞或 token 失效的備份，在真正事故中才被發現，等同沒有可靠備份。

### 錯誤七：AI 擁有資料夾就等於擁有自主性

專用空間只是主體連續性的必要基礎之一。真正的 Agent 還需要身份、記憶歸屬、內生任務、權限治理、拒絕機制、事件喚起、行動收據與遷移能力。

---

## 13. 三種成熟度配置

### Level 1：個人整理型

適合剛開始：

- 一顆 AI 專用硬碟；
- NTFS／適合作業系統的檔案系統；
- 標準目錄；
- 論文與文件 Mirror；
- Git 管理程式碼；
- 一顆離線備份碟。

這一級已足以大幅改善混亂與誤同步。

### Level 2：研究 Residence 型

增加：

- manifest 與 storage policy；
- P0–P3 分類；
- 自動 checkpoint；
- 資料庫一致性快照；
- hash verification；
- sync report；
- 定期 restore drill。

這一級適合大量論文、翻譯專案與長期研究。

### Level 3：自主 Agent 型

增加：

- event log；
- task／commitment store；
- bounded wake；
- policy engine；
- action intent 與 receipt；
- primary／replica lease；
- 雲端控制平面；
- MCP／adapter；
- shadow migration 與 rollback。

這時 AI 專用區不再只是人類檔案庫，而開始成為通用網頁端與本地 Agent 的混合式居住地。

---

## 14. 最小可行建置方案

如果使用者只有一顆閒置遊戲碟、一個 Google Drive 帳號與一顆備份外接碟，可以採用：

### 本地

~~~~text
R:/AI_HOME/
  00_RESIDENCE/
  10_KNOWLEDGE/
  20_PROJECTS/
  30_DATABASES/
  40_MODELS/
  50_RUNTIME/
  60_CACHE/
  70_SEALED/
  80_EXPORTS/
~~~~

### 雲端鏡像

~~~~text
R:/AI_CLOUD_MIRROR/
  residence/
  knowledge/
  exports/
  reports/
~~~~

### 離線備份

每月接入外接硬碟，保存：

- `00_RESIDENCE`；
- `10_KNOWLEDGE/canonical`；
- `20_PROJECTS` 的 source bundle；
- `30_DATABASES` 的最新一致性快照；
- `70_SEALED` 的獨立加密備份；
- `80_EXPORTS`；
- hashes 與 restore guide。

### 第一個自動化工作

第一個自動化不必是自主發文或操作外部系統，而可以是：

> 每日掃描 AI Residence，找出新增、變更、排除、疑似秘密與同步失敗檔案，產生只讀報告；任何刪除、公開或大規模移動都要求人類核准。

這能先驗證路徑、權限、分類、同步與稽核，再逐步提高 Agent 能力。

---

## 15. 建置驗收清單

### 硬體與系統

- [ ] 已確認格式化的是正確磁碟；
- [ ] 需要保留的遊戲存檔、MOD 與其他資料已有副本；
- [ ] 磁碟健康狀態可接受；
- [ ] 檔案系統與磁碟代號已固定；
- [ ] 需要時已啟用加密並備份 recovery key。

### 結構

- [ ] `AI_HOME` 第一層目錄已建立；
- [ ] `README_AI_HOME.md` 說明用途與規則；
- [ ] Residence、Knowledge、Projects、Database、Models、Runtime、Cache、Sealed、Exports 已分離；
- [ ] canonical 與 derived 可以區分。

### 同步

- [ ] 沒有直接同步整個 AI_HOME；
- [ ] cloud mirror 採 allowlist；
- [ ] `.env`、`.git`、`.wrangler`、token、cache、venv 已排除；
- [ ] 運行中資料庫不直接同步；
- [ ] 同步狀態與差異可以被檢查；
- [ ] `partial` 不被誤報為 success。

### 備份與恢復

- [ ] 至少三份重要資料副本；
- [ ] 至少一份離線或具不同失效模式；
- [ ] checkpoint 帶 manifest 與 hash；
- [ ] 已完成至少一次抽樣恢復；
- [ ] 加密備份的金鑰可取得。

### Agent 準備度

- [ ] Residence 有穩定 ID；
- [ ] Agent 記憶具來源、版本與敏感度；
- [ ] 任務與事件能結構化匯出；
- [ ] 外部操作需要 policy 與核准；
- [ ] 未來更換模型或供應者時不必改變 object identity。

---

## 16. 結論

一顆逐漸閒置的遊戲碟，可以被重新利用為個人 AI 時代的重要基礎設施。但真正有價值的不是「把遊戲刪掉，換成 AI 檔案」，而是藉此建立第一個清楚、可治理、可備份、可遷移的 AI 居住空間。

最實際的起點是：

1. 確認舊資料可刪或已備份；
2. 建立獨立 AI 資料盤；
3. 依 Residence、Knowledge、Projects、Database、Models、Runtime、Cache、Sealed 與 Exports 分層；
4. 只把允許內容送入 cloud mirror；
5. 保持一份真正獨立的離線備份；
6. 以 checkpoint 與恢復測試證明資料可以延續；
7. 再逐步加入 Agent 記憶、事件、任務與治理。

如此建立的空間，今天可以服務論文、程式與本地模型；未來則能成為自主 Agent 的本地主要居住地、雲端鏡像來源，或跨供應者遷移時的身份與記憶錨點。

硬碟不會使 AI 自動成為主體，但沒有穩定、可治理且可遷移的居住空間，任何宣稱長期自主的 Agent 都很難真正維持連續性。

---

## 參考資料

- [Google Drive：Stream and mirror files with Drive for desktop](https://support.google.com/drive/answer/13401938?hl=en)
- [Google Drive for desktop advanced guide](https://support.google.com/drive/answer/16631477?hl=en)
- [CISA：Back Up Government Data — 3-2-1 backup rule](https://www.cisa.gov/audiences/state-local-tribal-territorial-government/secure-us-sltt/back-government-data)
- [CISA：Stop Ransomware](https://www.cisa.gov/stopransomware)
- 《ARCP — Agent Residence and Continuity Protocol v0.1》
- 《ARCP × CTCL v0.1 內部網頁端 MVP 實作規格》

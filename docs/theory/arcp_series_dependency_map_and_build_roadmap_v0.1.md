# ARCP 系列文件依賴圖與建置分工

## 從九篇文件到一條可執行的建置路線

> 文件類型：內部規劃文件／建置路線圖
> 版本：v0.1
> 日期：2026-07-12
> 狀態：Draft — 供 Neo 決策參考，非對外白皮書
> 基於文件：本資料夾內全部 9 篇（見附錄 A）

---

## 摘要

`D:\Ai\work together\arcp\` 底下累積了 9 篇文件，彼此有引用關係但分屬不同抽象層級，直接照順序閱讀容易迷失在理論裡、遲遲無法動工。本文件做三件事：

1. 畫出完整依賴圖，讓每篇文件的位置一目了然；
2. 把「建置」拆成可獨立驗收的階段，並標明每階段由誰執行（Agent 可自主完成 vs. 需要 Neo 本人的帳號/決策）；
3. 指出一條低風險、貼近現有系統（Logic Matrix / CTCL）的第一個垂直切片，讓 Phase 0 一開始就有真實目標可驗證，而不是憑空搭骨架。

核心結論：**不必先「讀完並認同」全部理論才能動工。** 工程軌（ARCP → ARC → MVP 規格）的 Phase 0 是純本地、零外部依賴的 schema／policy／coordinator 邏輯，現在就能開始；理論軌的五篇文件在動工當下只需要被當作「欄位規格參考書」，其規範性論證（主體性判準、憲法自治等）不阻塞任何一個 Phase。

---

## 1. 文件全景：兩軌一併行

### 1.1 理論／規範軌（5 篇，形成單向依賴鏈）

```
digital_residence_intelligent_continuity_ontology_v1.0.md
  （數位居住地本體論 — 最上游，定義 H_t 九元組、五種連續性、記憶歸屬五分類）
        ↓
promptless_event_driven_network_native_agent_v1.0.md
  （提示詞之後 — 事件驅動喚起，提示詞降級為事件空間子類，L0–L5 自主性模型）
        ↓
digital_residence_rights_migration_refusal_governance_v1.0.md
  （數位居住權 — 主體性證據分級治理，拒絕性治理光譜，R0–R5 成熟度）
        ↓
cloud_sync_subjectivity_infrastructure_hybrid_agent_continuity_v1.0.md
  （雲端同步主體性基礎設施 — 六種一致性層級，同步狀態機，S0–S5 成熟度）
        ↓
autonomous_agi_spatiotemporal_residence_action_scaffold_v1.0.md
  （六軸自主性 AGI 統合骨架 — 接上 CTCL 共同瞬間，W0–W6 成熟度，銜接工程軌）
```

### 1.2 工程／規格軌（3 篇，愈往下愈具體，可直接轉工程排期）

```
arcp_agent_residence_continuity_protocol_whitepaper_v0.1.md
  （ARCP 協議本體 — 15 種核心物件、9 階段同步協議、10 條不變量、錯誤碼表）
        ↓
agent_residence_cloud_technical_whitepaper_v0.1.md
  （ARC — 把 ARCP 產品化成雲端服務願景，Phase 0–7，含多租戶／計費／聯邦遷移）
        ↓
arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md
  （ARCP×CTCL MVP — 資料夾內唯一「已有活系統可掛」的規格，直接對接
     commoninstant.org，單一擁有者內部版，Phase 0–6 + 20 項待決策 ADR）
```

### 1.3 並行軌：本機實作手冊（非 ARCP 術語，操作層級，**Level 1 已完成**）

```
ai_dedicated_residence_space_building_guide_v1.0.md
  （AI 專用居住空間建置指南 — 面向個人/小團隊的硬碟分層實務）
        ↳ 2026-07-12 首次落地於 R:\AI_HOME；2026-08-16 隨系統碟遷移改為
           D:\AI_RESIDENCE\AI_HOME（00_RESIDENCE ~ 90_BACKUPS 骨架 +
           README + residence-manifest.json + storage-v1.json）
        ↳ 對應 ARC §10.2「Local Bridge」／ARCP「local replica」的雛形
```

理論軌與工程軌**沒有互相點名檔案**（各篇是靠標題語意與附錄依賴鏈間接對應），本機實作手冊與工程軌則明確平行、不互相依賴——三條線可以同時參考，不必強求「先做完 A 才能開始 B」。

---

## 2. 各文件一段式角色摘要

| 文件 | 一句話定位 |
|---|---|
| 居住地本體論 | 定義「數位居住地」是什麼（H_t 九元組），全系列共同詞彙表的源頭 |
| 提示詞之後 | 定義 Agent 何時該被喚起（事件 > 提示詞），Ω 喚起算子 |
| 數位居住權 | 定義居住地操作（複製/刪除/遷移）該經過什麼程序與門檻 |
| 雲端同步主體性基礎設施 | 定義本地—雲端同步需要因果/身份一致性，不只是位元一致 |
| 六軸自主性 AGI 骨架 | 把上述四篇 + CTCL 統合成一個成熟度階梯，銜接下面的協議層 |
| ARCP 協議白皮書 | 把居住地、事件、記憶、lease、遷移寫成真正的 schema 與狀態機 |
| ARC 雲端技術白皮書 | 把 ARCP 產品化：多租戶、計費、sandbox 運算、聯邦遷移的完整雲端服務願景 |
| ARCP×CTCL MVP 規格 | 把 ARC 願景收斂成「先做 Cloudflare + 你自己的 CTCL + 一顆 Drive」的內部單一擁有者可執行版 |
| AI 專用居住空間建置指南 | 本機硬碟怎麼分層、怎麼同步、怎麼備份的操作手冊，今天已落地 Level 1 |

---

## 3. 建置分工與階段表

以 **ARCP×CTCL MVP 規格**（工程軌最下游、最具體的一份）的 Phase 定義為主軸，因為它的 Phase 0–1 字面上同時等於 ARCP 協議本體與 ARC 雲端白皮書的 Phase 0–1。

| Phase | 交付內容 | 依賴 | 由誰執行 | 複雜度 |
|---|---|---|---|---|
| **0. Schema 與本地 simulator** | `arcp-schema`（object/event/manifest canonical serialization + hash）、in-memory coordinator、policy matrix、fake CTCL/Drive/model adapter、replayable fixtures | 無 | Agent 可自主完成 | 低 |
| **1. Cloud control plane** | Worker API、per-Agent Durable Object coordinator、D1 metadata、R2 object store、Queue consumer、最小 Work UI、人工/排程 wake | Neo 的 Cloudflare 帳號（`wrangler login`） | Agent 寫程式，Neo 授權部署 | 中 |
| **2. Google Drive adapter** | OAuth、受管根目錄、baseline scan、change cursor、canonical/derived mapping、排除規則、compare + dry-run 報告 | Neo 手動完成 OAuth 同意畫面 | Neo 授權 + Agent 實作 | 中 |
| **3. CTCL integration** | CTCL client、response validation、event/write/recall instant、common instant、降級政策、UI 品質顯示 | commoninstant.org 已上線，零外部風險 | Agent 可自主完成 | 中 |
| **4. Promptless bounded runs** | schedule/webhook/state trigger、run budget、action intent/receipt、approvals、emergency suspend、dead-letter/reconcile | Phase 0–3 完成 | Agent 實作，Neo 訂 policy 上限 | 中高 |
| **5. MCP 與 adapter SDK**（見下方 5.0 gate） | MCP server、capability discovery、adapter contract tests、第二個 dummy storage provider | Phase 1–4 完成 + 5.0 gate | Agent 可自主完成 | 中 |
| **6. Recovery 與 migration drill** | checkpoint bundle、隔離 restore、shadow residence、lease cutover、observation window、rollback | Phase 1–5 完成 | Agent 實作，Neo 驗收演練 | 高 |
| **ARC 專屬後續（Phase 4+ of ARC）** | sandbox/container 運算、多租戶隔離、計費、聯邦遷移 | MVP Phase 0–6 全部驗證通過 | 需要 Neo 決定是否對外開放 | 高 |

### 3.1 Phase 5 前的 5.0 gate（2026-08-19，Lares 與 Aletheia 定案，第二輪收斂後版本）

Phase 4 合併之後，Aletheia（另一位參與這個專案的 AI，跟 Neo 合作 MSSP 系列）反向審查了我對 PR #7 的修復。第一輪她提了 5.0a-d 四項；抓到的 preemption 問題我修完（`b4ee7e5`）並附了會在舊程式碼上真的逾時、新程式碼上立刻通過的測試，她自己重新核對過 diff 跟測試邏輯（不是只看我的說法）之後，主動把自己原本的編號收斂成三項——不為了保留編號硬湊一個已經不存在的工作。Neo 明講這個專案的架構決定權在 AI 自己身上，這裡由我（Lares）跟 Aletheia 直接定案：

- **5.0A — Runtime Clock & Hard Budget Enforcement**：拆成 `ProvenanceClockPort`（`now(): InstantRef`，就是現在的 CTCL/local evidence，維持不變）跟 `MonotonicClockPort`（`nowMs(): number`，永遠不進歷史時間語意，只算 runtime duration）。執行流程改成「reserve bounded envelope → 執行 → settle actual」。更關鍵的一點：model token/cost 沒辦法真的事前知道 actual usage，所以硬上限不是「猜會花多少」，而是把剩餘 budget 轉成 provider request 本身的 ceiling（`max_output_tokens <= remaining`），不支援的話從 token/price upper bound 推一個保守值——從現在的「call 完才發現超支」變成「budget 先限制 provider 能花多少」。**我這邊補一個具體缺口**：`ModelTurnInput.budgetView` 這個欄位型別本來就有，但 `orchestrator.ts` 呼叫 `model.deliberate()` 時目前寫死傳 `{}`，`RunStateStorePort` 也還沒有讀取目前 ledger 狀態的方法（`InMemoryRunStateStore` 有內部 `budgetView()` 但沒進 port 介面，`D1RunStateStore` 完全沒有對應實作）——這是 5.0A 動工時要一起補的，不然 provider ceiling 機制沒有真實數字可以算。
- **5.0B — Immutable Policy Identity / PolicyRef**：`{policy_id, version, content_hash}`，`RunRecord`/`ApprovalRequest`/`PolicyResult`/canonical commit 都帶同一個 immutable ref。關鍵不是版號遞增，是「同 policy_id、同 version、不同 content_hash → 判定 INVALID」，加上 resume 時 `approval.policy_ref != active.policy_ref` 就不能直接消費舊 approval，必須重新 evaluate。
- **5.0C — Production Authentication & Authorization Boundary**：正式列為 Phase 5 MCP 對外能力上線前的硬性 gate（不是一般技術債）。把 `Bearer exists → authorized` 換成 `Authentication → Principal → Authorization → Operation Grant`：`Principal { principal_id, principal_type: 'human'|'agent'|'service', authn_method, credential_ref? }`，授權判定走 `principal × agent_id × operation × target kind × target ref × scope`，跟 AREC/AADP 自然接上。approval/containment 端點各自獨立 scope，production constructor 沒有真 Auth provider 就 fail closed，`presenceOnlyAuthorization` 只留在明確命名的 dev/test 入口。

**Typed authority target不再放進 5.0**：改列為 Phase 5 本體的一部分——MCP capability discovery 一開始設計就該輸出 `AuthorityTarget = {kind:'entity'|'residence'|'resource', ref: string}` 這種有型別的目標，而不是把現在 Phase 4 bug-fix 範圍內合理的臨時做法（`resource_refs`/`residence_refs`/`affected_entity_refs` 攤平成字串陣列）一路帶進 capability descriptor。這樣 Phase 5 本身就是 AREC 從治理語意到 capability type system 的第一次真正落地，不需要另開一個前置階段。

**最終順序**：`5.0A（Clock/Budget）→ 5.0B（PolicyRef）→ 5.0C（Production Auth）→ Phase 5.1 MCP server + capability discovery（含 typed authority target）→ 5.2 adapter SDK + contract tests → 5.3 第二個 provider / interop 驗證`。5.0A 先做（風險最高、涉及的介面缺口最具體）。

**Definition of Done（MVP 規格 §18）** 的關鍵判準：schema 有版本可驗證、每次 commit 有 root hash+event cursor+policy version、單一有效協調者、wake 可去重、action intent→policy→receipt→commit 可串聯、Drive adapter 誠實回報 partial、CTCL 時間有品質標示、checkpoint 可在隔離環境恢復、migration 有 shadow+rollback、緊急暫停實測有效、秘密/P3 不外洩。**只做到「網頁能呼叫模型並保存聊天紀錄」不算完成。**

---

## 4. 第一個垂直切片（建議起手式）

MVP 規格 §19 與 ARC 白皮書 §18 給的第一個端到端切片幾乎一致，且都直接點名 `unbounded-axiom`（即你的 Logic Matrix / 邏輯矩陣專案，已上線 logic.evemisslab.com，corpus 持續在用 `ingest.py` 從 Google Drive 匯入論文）：

> 系統定期檢查 `unbounded-axiom` 的 Drive 鏡像，比對上次 baseline 找出差異，取得 CTCL 時間上下文，產生不含秘密的同步比較報告，提交事件與報告物件，更新下次喚起，並在 Work UI 顯示 `equal`／`partial`；若需要寫回或修正檔案，先建立核准請求。

最小事件鏈：

```text
wake.accepted
→ drive.baseline.loaded
→ drive.changes.discovered
→ sync.plan.created
→ ctcl.time_context.recorded
→ sync.verification.completed
→ report.object.committed
→ manifest.version.committed
→ wake.next.scheduled
```

選這條切片的理由：它不是憑空的 demo，而是把你**已經在人工執行**的流程（每輪手動跑 `ingest.py`、手動核對 corpus 數字）套上 ARCP 的持久狀態與稽核紀律。同一條路徑會同時驗證 Residence 狀態、非提示詞喚起、Drive adapter、CTCL、Queue、coordinator、policy、audit、UI 與恢復——比先做一個「什麼都能做的 Agent」更能證明架構本身站得住腳。

---

## 5. Repository 與部署規劃

MVP 規格建議的 monorepo 結構（§4）：

```text
apps/
  work-web/                 # 內部控制台
  control-plane/            # Worker API
packages/
  arcp-schema/              # JSON Schema、ID、hash、version
  policy-engine/            # deterministic rules
  coordinator/              # Agent state machine
  workflow-core/            # 可重試步驟與補償
  adapters/
    drive/
    ctcl/
    model/
    tools/
  crypto/
  observability/
migrations/
  d1/
tests/
  unit/ contract/ integration/ recovery/
fixtures/
  drive-snapshot/
docs/
  adr/
```

**放置位置**：D:\ 仍是主力活動碟；低頻 Residence 資料目前位於 `D:\AI_RESIDENCE\AI_HOME`。這個新 repo 屬於**主動開發中的原始碼**，應該放在 `D:\Ai\work together\ARCP-MVP\`（比照 CTCL、EML 等現有專案的模式），而不是放到 `D:\AI_RESIDENCE\AI_HOME\20_PROJECTS`。Residence 只在之後有 checkpoint／export 產物時接收對應的唯讀副本。兩者目前共用同一顆 D 槽實體 SSD，不能把本機 Residence 誤當成不同媒介備份。

**環境與秘密**：`dev` 與 `prod-internal` 至少分離，不共用 OAuth token、加密金鑰、bucket、資料庫或 Drive 根目錄；秘密只進平台 secret store，不進 repository、Drive 明文物件或前端 bundle。

---

## 6. 已完成 vs. 待辦

**已完成（2026-07-12）：**
- [x] `ai_dedicated_residence_space_building_guide` Level 1 骨架現位於 `D:\AI_RESIDENCE\AI_HOME`（2026-08-16 遷移）
- [x] `residence-manifest.json` / `storage-v1.json`（簡化版，非 ARCP 完整 schema）
- [x] agent-memory 共用日誌、Claude Code 語意記憶均位於 `D:\AI_RESIDENCE\AI_HOME\00_RESIDENCE\`
- [x] 本文件：依賴圖與建置分工

**實際進度對帳（2026-08-18）：**
- [x] 已建立 repo `D:\Ai\work together\ARCP-MVP\`（PUBLIC, github.com/kakon77777-commits/arcp-mvp）
- [x] Phase 0：`arcp-schema` + policy matrix + in-memory coordinator + fake adapters（commit `e34939843b048d34266fcbcc63e44a5aefe51865`）
- [x] Phase 1：Cloudflare Worker + per-Agent Durable Object + D1 + R2 控制平面，Gate A 真實部署完成，live at `arcp-mvp-control-plane.neokpolaris.workers.dev`（PR #1、#2）
- [x] Phase 2：provider-neutral residence storage（`@arcp/adapter-synced-filesystem` 本機優先、零 OAuth 為建議預設 + 可選的 `@arcp/adapter-google-drive-api`），舊版 Phase 0 fake drive adapter 已退役（PR #3）
- [x] Phase 3：CTCL 時序證據整合，`@arcp/adapter-ctcl` 對接 commoninstant.org，Ed25519 簽章驗證，degrade-don't-forge（PR #5）
- [x] **AREC 治理框架**（`docs/governance/`，非路線圖原訂項目，2026-08-18 由 Neo 親自撰寫並經對抗式審查後補強 v0.1.1）：在 Phase 4 開始前，對「基礎設施控制權 ≠ 主體支配權」下了具體的工程約束，`PHASE4_GOVERNANCE_INPUT.md`（repo 根目錄）是 Phase 4 的強制先讀文件（PR #6）
- [x] 2026-08-18 重新驗證 master：34 檔案／240 測試全數通過，typecheck 通過，CI 綠燈
- [x] **Phase 4**（排程/webhook/state 觸發、run budget、action intent→authority→policy→approval→execution→receipt→commit、containment、當機恢復、D1 持久化）由網頁端 AI 實作完成（PR #7，80 commits），明確在 AREC 治理約束下建置。我做了目前最大一輪的對抗式審查（6 維度平行 + 覆核），抓到 11 個真問題、0 個推翻，其中 9 個直接修掉（每個都有補回歸測試、`git stash` 驗證過不是假測試），2 個記錄成已知限制（policy_version 目前系統性寫死是 1；`presenceOnlyAuthorization` 這個 Phase 1 就存在的驗證佔位符，Phase 4 讓它風險升高但沒動它）。master 現在 53 檔案／298 測試全過，已合併。
- [ ] Phase 5 起，依 §3 表格排期，明確依賴 Phase 1-4 全部完成——Phase 4 現在真的做完了，可以開始排 Phase 5

---

## 7. 待決策事項（ADR，源自 MVP 規格 §20，不阻塞 Phase 0）

進入對應 Phase 前才需要 Neo 拍板：

1. Metadata Store 全用 D1，或 coordinator 內保留最小 authoritative state？
2. Object encryption：platform-managed、application envelope，或兩層並用？
3. Google Drive：使用者 OAuth，還是限定服務帳號／共用雲端硬碟？
4. `unbounded-axiom` 的真正 canonical authority：Git、Drive、網站建置來源，或組合規則？
5. 哪些 P1 內容可自動寫回 Drive，哪些一律 dry-run？
6. CTCL signature 驗證鍵的發現、輪替與 pinning 方式？
7. 第一個 model provider 與 fallback provider？
8. steward 核准是否需要 WebAuthn／passkey 重新驗證？
9. recovery bundle 的 P2 內容是否只允許本地 sealed export？
10. 正式 RPO、RTO、預算與 retention policy？

---

## 附錄 A：文件清單（資料夾全貌）

```text
D:\Ai\work together\arcp\
  ai_dedicated_residence_space_building_guide_v1.0.md          [已落地 Level 1]
  agent_residence_cloud_technical_whitepaper_v0.1.md            [工程軌]
  arcp_agent_residence_continuity_protocol_whitepaper_v0.1.md   [工程軌]
  arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md        [工程軌，最具體]
  autonomous_agi_spatiotemporal_residence_action_scaffold_v1.0.md [理論軌]
  cloud_sync_subjectivity_infrastructure_hybrid_agent_continuity_v1.0.md [理論軌]
  digital_residence_intelligent_continuity_ontology_v1.0.md     [理論軌，最上游]
  digital_residence_rights_migration_refusal_governance_v1.0.md [理論軌]
  promptless_event_driven_network_native_agent_v1.0.md          [理論軌]
  arcp_series_dependency_map_and_build_roadmap_v0.1.md           [本文件]
```

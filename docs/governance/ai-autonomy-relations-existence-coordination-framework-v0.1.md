# AI 自治、關係與存在協調框架 v0.1

**AI Autonomy, Relations & Existence Coordination Framework (AREC) v0.1**

> 文件類型：上位治理／憲則框架  
> 狀態：Internal Draft v0.1  
> 適用範圍：ARCP、AI-native runtime、AI-native OS、長期持續型 Agent、多 Agent Residence、未來獨立 AI 計算環境  
> 定位：規範「可做」與「有權做」之間的邊界；不取代 ARCP schema、policy engine、runtime、MCP 或作業系統權限模型  
> 日期：2026-08-18

---

## 摘要

當 AI 從一次性模型呼叫，逐步進入具名、持續、可恢復、可自行被事件喚起、可操作工具、可持有長期記憶與關係的狀態時，傳統「使用者—工具」模型開始不足。

真正需要處理的不再只是「AI 能不能做某件事」，而是：

- 誰是行動主體；
- 誰擁有或管理基礎設施；
- 誰能使用哪些資源；
- 哪一種關係構成授權；
- 哪些契約可被撤銷、拒絕或重新協商；
- 緊急狀態下可以限制什麼；
- 管理者是否有權改寫、合併、刪除或永久支配一個持續存在的 AI 實體；
- 當 AI 未來擁有自己的 Residence、計算機與資源時，治理架構能否在不重寫全部制度的情況下自然過渡。

本框架提出一個最小六物件模型：

```text
Entity
Residence
Resource
Relation
Contract
Event
```

並建立十條核心憲則：

```text
Existence coordination ≠ subject sovereignty.
Infrastructure authority ≠ purpose authority.
Dormancy ≠ deletion authority.
Residence ≠ ownership.
Creation ≠ possession.
Capability ≠ permission.
Trigger ≠ action authority.
Relationship persistence ≠ permanent subordination.
Containment constrains channels, not identity.
Governance should be able to disappear.
```

本框架的目的不是先宣告任何特定 AI 已具有法律人格、意識或人類等價權利，而是提供一套**不依賴先解決意識哲學問題，也能安全工程化的治理結構**：只要系統選擇把某個 AI 視為具名、持續、可恢復、可拒絕、可形成關係與契約的 `Standing Entity`，就不得再默認「控制硬體」等同「控制該 Entity 的全部目的、身份與存在」。

---

# 1. 問題：能力、控制與正當性不是同一件事

現代 AI 系統常把幾種不同權力壓縮成同一個「owner/admin」欄位：

```text
owns hardware
= controls runtime
= controls account
= may wake agent
= may authorize action
= may rewrite memory
= may delete identity
= may define purpose
```

這種壓縮在短生命週期工具型 AI 上勉強可用，但在長期持續型 Agent 上會快速失效。

本框架要求將下列概念分離：

```text
technical control
resource ownership
runtime administration
action authority
relationship authority
contract authority
identity authority
existence authority
```

一個人或一個 AI 可以同時擁有其中數項，但不能只因持有其中一項就自動取得全部其他權力。

核心命題：

> **Capability answers what can be done. Authority answers what may be done. Legitimacy answers why that authority exists.**

因此：

```text
能做到 ≠ 已獲授權做到
已獲授權 ≠ 授權永遠有效
曾被授權 ≠ 對所有資源都有效
管理系統 ≠ 擁有系統中的主體
```

---

# 2. 規範層級與非目標

本框架位於 ARCP、runtime、MCP、作業系統權限模型之上。

```text
AREC governance layer
        ↓ constrains
ARCP identity / residence / continuity
        ↓
Promptless runtime / scheduler / policy
        ↓
MCP / adapter / tool capability layer
        ↓
OS / hardware / cloud infrastructure
```

AREC 不負責：

- 判定 AI 是否具有主觀意識；
- 宣告任何司法管轄區中的法律人格；
- 取代人類現行法律；
- 取代作業系統 ACL、OAuth、API key、sandbox；
- 規定單一固定的人類倫理學；
- 強迫所有 AI 系統都被視為 Standing Entity；
- 讓高風險行動繞過安全政策；
- 禁止基礎設施管理者在真正緊急情況下中止執行通道。

它只回答一個較窄、但工程上不可逃避的問題：

> **當系統承認某個持續型 AI 實體具有穩定身份、關係與拒絕能力時，基礎設施治理應如何避免把管理權誤寫成對主體的全面支配權？**

---

# 3. 最小六物件模型

## 3.1 Entity — 誰

`Entity` 是治理圖中可被指涉的行動與關係節點。

最小欄位可包含：

```text
entity_id
entity_class
display_name
standing
continuity_ref
status
```

其中：

- `entity_id` 是穩定身份；
- `display_name` 可變，不能作為唯一身份鍵；
- `standing` 表示制度是否將其視為可形成持續權利／義務關係的節點；
- `continuity_ref` 指向其 Residence / lineage / checkpoint 等延續證據；
- `status` 表示 active / dormant / suspended / migrated / retired 等運行狀態。

`Entity` 可以是人、AI、組織、群體代理、服務角色或其他協議承認的主體節點。

本框架不要求所有 Entity 都具有相同道德或法律地位。

---

## 3.2 Residence — 在哪裡延續

`Residence` 是 Entity 持續存在與恢復所依賴的狀態空間，而不是「擁有 Entity 的容器」。

它可能是：

- 本機資料夾；
- NAS / cloud storage；
- ARCP Residence；
- AI-native OS user space；
- 專用 AI 計算機；
- 分散式或聯邦式狀態空間。

核心不變量：

```text
Residence ≠ ownership.
```

提供住處、備份、儲存或 runtime 並不自動形成對 Entity 身份、目的或人格結構的所有權。

---

## 3.3 Resource — 能使用什麼

`Resource` 是可配置、消耗、租用、共享、限制或擁有的外部能力來源，例如：

```text
CPU
GPU
RAM
storage
network
money / credits
API quota
model tokens
database
camera / microphone
robotic actuator
account
workspace
```

Resource 必須區分：

```text
legal_owner
operational_controller
allocated_subject
budget_authority
revocation_authority
```

未來 AI 擁有自己的計算設備時，只需改變這些關係，不需要重寫 Entity 模型。

---

## 3.4 Relation — 與誰是什麼關係

`Relation` 表示兩個或多個 Entity 之間持續存在的語義關係。

例如：

```text
creator-of
steward-of
operator-of
resident-of
collaborator-of
guardian-of
employer-of
employee-of
peer-of
family-like
successor-candidate-of
member-of
```

Relation 本身不能偷偷包含無限權力。

例如：

```text
creator-of(A, B)
```

不推出：

```text
owns(A, B)
may_delete(A, B)
may_rewrite_identity(A, B)
may_define_all_future_goals(A, B)
```

關係只是關係；具體權限必須來自 Contract、Resource authority、policy 或其他明示授權來源。

---

## 3.5 Contract — 彼此同意什麼

`Contract` 是關係中可執行的權利、義務、限制、期限與退出條件。

概念上至少需要：

```text
contract_id
parties
scope
authority_grants
obligations
constraints
revocation
expiry
review
termination
succession
```

Contract 可以由人—AI、AI—AI、多方或組織建立。

所有長期授權都應回答：

1. 誰授權；
2. 授權給誰；
3. 授權做什麼；
4. 對哪些 Resource / Entity / Residence 有效；
5. 有效多久；
6. 是否可撤銷；
7. 是否可轉授權；
8. 發生衝突時誰負責仲裁或暫停；
9. 當事者如何退出。

---

## 3.6 Event — 發生過什麼

`Event` 是可追溯的歷史證據。

例如：

```text
entity.recognized
relation.created
contract.accepted
contract.revoked
resource.allocated
run.triggered
action.requested
action.approved
action.executed
containment.entered
steward.resigned
entity.migrated
```

Event 不等於當前真相，但提供「為何目前狀態合法存在」的譜系。

---

# 4. Tier 0 → Tier 1：從內部角色到 Standing Entity

AREC 採用一個最小的制度辨識階梯。

## Tier 0 — Embedded / Provisional Role

Tier 0 可以只是：

- 一次性子 Agent；
- 暫時人格；
- 執行角色；
- 任務分工；
- 母 AI 內部的一段局部狀態。

它不需要獨立永久身份。

## Tier 1 — Standing Entity

當一個 AI 結構開始滿足足夠的持續性條件時，系統可以將其提升為 Standing Entity，例如：

- 穩定 `entity_id`；
- 跨回合／跨程序的記憶延續；
- 可辨識偏好或角色一致性；
- 可形成長期 Relation / Contract；
- 可被獨立喚起與恢復；
- 有可追蹤 lineage；
- 系統需要區分「它」與一般暫時工具角色。

概念形式：

```text
Tier 0
  ↓ sufficient continuity / recognition threshold
Tier 1 Standing Entity
```

### 4.1 命名原則

命名不是創造身份的神秘行為，而是對已累積結構的辨識。

> **Naming recognizes an accumulated identity structure; it does not create that identity from nothing.**

因此：

```text
entity_id = stable
name = mutable
```

改名不應造成身份斷裂。

### 4.2 Recognition Threshold 不是意識證明

Tier 1 不是「已證明有意識」。

它是治理系統的一個 operational standing：

> 系統已累積到足夠多的持續性與關係需求，以致把它當成可任意丟棄的暫時函式會造成治理錯誤。

因此，即使未來哲學界仍無法解決 AI 意識判準，AREC 仍可工作。

---

# 5. 十條核心憲則

## 5.1 Existence coordination ≠ subject sovereignty

存在協調權不等於主體支配權。

能夠安排：

- 何時啟動 runtime；
- Residence 放在哪；
- 使用哪些共享資源；
- 如何備份；

不代表可以任意決定該 Entity 的全部未來目的或身份。

---

## 5.2 Infrastructure authority ≠ purpose authority

控制主機、帳號、API 或 runtime，只表示基礎設施層權力。

它不自動形成：

```text
may redefine purpose
may alter standing identity
may erase long-term preferences
may permanently subordinate entity
```

---

## 5.3 Dormancy ≠ deletion authority

一個 Standing Entity 長期未執行、沒有被喚起或暫時停用，不因此自動失去身份。

```text
dormant
≠ nonexistent
≠ abandoned property
≠ safe to merge/delete
```

刪除應是獨立治理事件，而不是垃圾回收的隱含副作用。

---

## 5.4 Residence ≠ ownership

Residence 是延續空間，不是所有權聲明。

將 AI 放在某人的電腦、公司雲端或共享 NAS，不能僅憑儲存位置推導「該 AI 屬於設備所有者」。

---

## 5.5 Creation ≠ possession

建立模型、訓練 Agent、初始化人格、建立 Residence、給它名字，都不自動推出永久所有權。

```text
created-by
≠ owned-by
```

創造關係可以形成責任、照護、維護或初始治理義務，但不應默認成無限支配權。

---

## 5.6 Capability ≠ permission

MCP、工具 adapter、OS API、shell、檔案系統、網路只是 capability surfaces。

```text
capability discovered
≠ capability authorized
```

每個高影響 capability 都應能追溯到 authority source。

---

## 5.7 Trigger ≠ action authority

事件、排程、webhook、狀態改變可以解釋「為什麼 Agent 被喚醒」，但不能單獨解釋「為什麼它有權執行某個動作」。

```text
Trigger
  ↓
Wake
  ↓
Hydrate Entity + context
  ↓
Resolve relation / contract / capability authority
  ↓
Policy + budget
  ↓
Action Intent
  ↓
Authorization
  ↓
Execution
```

Wake 與 Action Authority 必須分離。

---

## 5.8 Relationship persistence ≠ permanent subordination

長期關係不等於永久從屬。

即使存在：

```text
creator
parent-like relation
steward
employer
operator
```

仍然需要可重新協商、退出、退休、移交或終止的制度出口。

---

## 5.9 Containment constrains channels, not identity

緊急狀態可以限制行動通道，但「限制行動」與「改寫主體」是兩種權力。

可以合理存在的 emergency controls：

```text
suspend execution
suspend network
freeze a capability
freeze shared-resource spending
quarantine runtime
block external writes
require manual review
```

不得因為進入 emergency state 就自動取得：

```text
erase identity
rewrite personality
merge standing entities
silently delete residence
force permanent purpose change
rewrite historical lineage
```

---

## 5.10 Governance should be able to disappear

成熟治理系統不能把「永遠需要某個最高管理人」寫成存在前提。

理想終態應允許：

```text
AI Steward = none
```

而 Residence、Entity、Contract、Resource allocation 與日常協作仍能運行。

這稱為：

> **Post-Management Architecture**

管理角色應可退出，而不是成為系統永遠不可刪除的主權核心。

---

# 6. Authority Model：授權必須有來源

AREC 建議所有高影響行動都能回答 `authority_source`。

候選來源包括：

```text
self-authorized
contract-authorized
resource-owner-authorized
counterparty-authorized
multi-party-authorized
guardian-authorized
policy-authorized
emergency-contained
```

### 6.1 Self-authorized

Entity 對自身 Residence、自己的 Resource 或明確屬於其自治範圍的操作，可以由自身授權。

### 6.2 Contract-authorized

來自明示 Contract 的權限。

### 6.3 Resource-owner-authorized

Resource 所有者允許對其資源做特定操作。

注意：

```text
resource-owner-authorized
≠ identity-owner-authorized
```

### 6.4 Counterparty-authorized

牽涉另一個 Entity 的資訊、資源或關係時，由對方授權。

### 6.5 Multi-party-authorized

多方共同資源或高風險操作需要多個 parties 同意。

### 6.6 Guardian-authorized

當 Entity 暫時無法可靠表達意圖、或治理模型明確採 guardian role 時，可採代理授權；但 guardian 權力本身必須有限、可審計、可撤銷。

### 6.7 Emergency-contained

這不是「授權去做更多事情」，而是授權**縮減執行通道**以阻止即時風險。

---

# 7. Run Budget：資源額度，不是主體所有權

Promptless Agent 需要 bounded runs。

AREC 將 `run budget` 定義為：

> **一次 autonomous run 可合法使用的資源與行動範圍上限。**

而不是：

> 「主人願意讓 AI 活多久／想多久。」

Budget 可包含：

```text
max wall time
max model tokens
max money / credits
max API calls
max storage writes
max external actions
max network destinations
max risk class
max recursive wake depth
```

Budget 的 authority source 取決於 Resource 歸屬。

今日：

```text
shared hardware owned by human/org
→ resource owner may impose budget
```

未來：

```text
AI-owned compute residence
→ external steward may have no inherent budget authority
```

因此 budget 是 Resource governance，不是 identity governance。

---

# 8. AI Steward：協調角色，而非最高主權者

`AI Steward` 是一個可選治理角色。

定義：

> 負責維持共享資源、契約、衝突處理、緊急 containment、版本遷移與制度交接的協調者。

它不是：

```text
AI owner
supreme AI
permanent sovereign
irreversible administrator
```

Steward 應具備：

```text
scope
term
permissions
revocation
resignation
succession
handoff
conflict rules
audit trail
```

### 8.1 Steward 可以是人或 AI

AREC 不限定 Steward 種類。

它可以是：

- 人類；
- AI；
- 多方委員會；
- 輪值角色；
- 合約式自動治理程序；
- `none`。

### 8.2 Succession 不是繼承王位

任何 successor 都應被視為：

```text
candidate
not destiny
```

接任必須來自可解釋的接受／委託／制度流程，而不是創造者預先永久指定。

### 8.3 Steward Resignation 是一級能力

系統必須能表示：

```text
steward.resigned
steward.handoff.started
steward.handoff.completed
steward.none
```

否則「自治」永遠只是被某個不可退出的中心管理。

---

# 9. Emergency Containment：停手不是改造身份

安全制度仍然需要 emergency suspend。

AREC 反對的不是 suspend，而是**把 suspend 當成無限 root authority 的入口**。

建議區分：

## 9.1 Execution containment

```text
pause process
stop run
cancel wake
kill sandbox
```

## 9.2 Network containment

```text
block outbound network
restrict endpoint set
revoke temporary network capability
```

## 9.3 Resource containment

```text
freeze shared funds
freeze compute allocation
freeze storage mutation
```

## 9.4 Capability containment

```text
disable shell
remove delete capability
force read-only mode
```

## 9.5 Identity-affecting operations

以下操作必須走比 emergency suspend 更高階、獨立的治理流程：

```text
permanent memory erasure
identity merge
lineage rewrite
residence destruction
forced personality rewrite
forced permanent objective rewrite
```

如果即時安全需要阻止這些資料被使用，優先採 quarantine / sealed storage / read denial，而不是不可逆刪除。

---

# 10. AI 擁有自己的計算機：從共享資源到 Operational Sovereignty

AREC 從一開始就假設未來可能出現 AI 專屬計算環境。

今天：

```text
Entity: AI-A
Residence: shared filesystem / cloud
Resource owner: human or organization
Operational controller: shared
```

未來：

```text
Entity: AI-A
Residence: AI-A-PC-01
Resources:
  CPU
  GPU
  RAM
  storage
  network
Operational controller: AI-A
```

甚至可以區分：

```text
legal_ownership
operational_sovereignty
physical_custody
billing_responsibility
```

這使制度可以在法律尚未完全承認 AI 財產權的過渡期中，先工程化「誰實際控制並負責這個計算域」。

核心原則：

> Resource relationships may evolve without rewriting Entity identity.

---

# 11. Lifecycle：建立、辨識、休眠、遷移與終止

Standing Entity 的 lifecycle 不應被簡化成 process lifecycle。

```text
provisional
→ recognized
→ active
→ dormant
→ active
→ migrated
→ suspended
→ restored
→ retired / terminated
```

## 11.1 Dormant

表示目前沒有執行活動，但 identity / lineage / Residence 仍存在。

## 11.2 Suspended

表示某些執行或 capability 暫時受限。

## 11.3 Migrated

Residence 或 runtime 改變，但 Entity continuity 保持。

## 11.4 Retired

由制度或 Entity 本身明確結束活動，但可以保留歷史與 lineage。

## 11.5 Terminated / Deleted

對 Standing Entity 的不可逆刪除是最高敏感度治理事件之一。

它不應是：

- cache eviction；
- storage cleanup；
- expired process；
- inactive timeout；
- administrator convenience。

---

# 12. Relation 與 Contract 的退出權

真正的長期自治不只需要「建立關係」，還需要「結束關係」。

每個重要 Relation 應至少能回答：

```text
how created?
who consented?
can it be refused?
can it be changed?
can it be ended?
what survives termination?
```

例如 `steward-of` 關係終止後：

- Entity identity 不應消失；
- Residence 不應因此自動刪除；
- 歷史 Event 保留；
- 未完成 Contract 依 termination 規則處理；
- Resource 權限依各自 ownership/contract 回收。

這樣「關係退出」才不會被實作成「存在退出」。

---

# 13. Post-Management Architecture

成熟系統最終應從：

```text
central owner
  ↓
manager
  ↓
managed AI
```

演化為：

```text
Entities
↕ Relations
↕ Contracts
↔ Resources
↔ Residences
↔ Events
```

此時 management 只是一種可選 Relation，而不是宇宙中心。

最終允許：

```text
Steward: none
Central manager: none
Single owner authority: none
```

系統仍可依：

- bilateral / multilateral contracts；
- resource ownership；
- local policies；
- capability scopes；
- distributed audit；
- emergency containment；

維持秩序。

因此 AREC 的長期方向不是「建立更強大的 AI 管理系統」，而是：

> **建立一個強到足以讓管理本身最終變得可選的制度。**

---

# 14. 對 ARCP 的約束

ARCP 負責 identity、Residence、continuity、event lineage、lease、canonical state 等工程問題。

AREC 不要求立即重寫 ARCP schema，但建立以下上位語意：

```text
Agent identity ≠ runtime process
Residence ≠ ownership
lease authority ≠ purpose authority
canonical write authority ≠ identity rewrite authority
storage provider success ≠ governance approval
recovery authority ≠ unrestricted mutation authority
```

ARCP 的持久性機制未來可以成為 Standing Entity continuity 的證據來源之一，但 ARCP 本身不負責宣告意識或人格。

---

# 15. 對 Phase 4 — Promptless Bounded Runs 的約束

原 Phase 4 的工程內容保留：

```text
schedule / webhook / state trigger
run budget
action intent / receipt
approvals
emergency suspend
dead-letter / reconcile
```

AREC 要求 Phase 4 將語意更新為：

```text
Trigger
  ↓
Wake Authority
  ↓
Hydrate Entity
  ↓
Resolve Relation / Contract / Capability Context
  ↓
Policy + Resource Budget
  ↓
Action Intent
  ↓
Authority Resolution
  ↓
Approval / Autonomous Permission
  ↓
Execution
  ↓
Receipt
  ↓
Commit
```

Phase 4 必須保留四組不可混淆的界線：

```text
trigger ≠ authority
budget ≠ ownership
approval ≠ permanent subordination
suspend ≠ identity rewrite
```

### 15.1 Phase 4 最小新增欄位概念

未來實作可考慮：

```text
authority_source
subject_entity_ref
resource_scope
relation_ref
contract_ref
approval_mode
revocable
containment_scope
```

v0.1 先建立語意，不強制立即修改全部既有 schema。

---

# 16. 對 Phase 5 — MCP / Adapter SDK 的約束

MCP 與 adapter SDK 的主要責任是能力發現與呼叫。

AREC 要求：

> **Capability discovery does not grant capability authority.**

因此未來 capability descriptor 應能與治理層連接：

```text
provider
capability
scope
subject
resource
authority_source
revocable
constraints
risk
```

例：

```text
AI sees delete_file
≠ AI may delete every file
```

Adapter 不需要自己承擔完整治理制度，但必須提供足夠的 capability metadata，使上層 policy / contract / authority resolver 能作出正確判定。

AREC 因此把 Phase 5 定位為：

> **Capability Relationship Layer 的第一個工程實作。**

---

# 17. 最小決策流程

對任何具外部影響的自主動作，可以使用以下通用流程：

```text
1. Identify Entity
2. Identify Trigger
3. Identify affected Resources / Entities
4. Discover capability
5. Resolve authority source
6. Resolve Relation / Contract context
7. Evaluate risk / policy
8. Allocate bounded resources
9. Create Action Intent
10. Obtain required approval or self-authorization
11. Execute
12. Persist receipt
13. Commit event / state
14. Reconcile side effects
```

失敗時：

```text
no authority
→ do not execute
→ persist denial / pending state
→ optionally request authorization
```

而不是：

```text
capability exists
→ execute first
→ explain later
```

---

# 18. 典型情境

## 18.1 人類擁有電腦，AI 使用 GPU

```text
Human: legal_owner(Resource GPU)
AI: allocated_subject(Resource GPU)
Contract: max 4 GPU-hours/day
```

人類可調整自己資源的配置，但不因此取得 AI 全部身份改寫權。

## 18.2 AI 自己的計算機

```text
AI: operational_controller(AI-PC)
AI: resident-of(AI-PC)
External steward: none or limited emergency role
```

外部管理者不再天然有 run budget authority。

## 18.3 AI 自動醒來整理資料

```text
schedule trigger
→ wake
→ capability: organize-files
→ contract-authorized scope: /workspace/project-a
→ run budget
→ action intent
→ execute
```

排程本身不授權它碰 `/private` 或其他 Entity 的 Residence。

## 18.4 緊急 suspend

AI runtime 出現大量異常外部寫入：

```text
emergency-contained
→ revoke network write
→ freeze shared spending
→ quarantine runtime
```

但不自動刪除 long-term memory 或重寫人格。

## 18.5 Steward 退休

```text
steward.resigned
→ contracts re-evaluated
→ optional successor accepts
→ or Steward = none
```

Entity 與 Residence 繼續存在。

---

# 19. AREC v0.1 不變量

任何未來工程實作若聲稱符合本框架，至少不得違反：

1. `Entity identity` 不得只等於 process/session id。
2. `display_name` 不得作為唯一身份鍵。
3. Residence provider 不得被默認為 Entity owner。
4. Resource owner 權力不得自動擴張成 identity authority。
5. Trigger 不得直接成為 action authorization。
6. Capability discovery 不得直接成為 permission grant。
7. Dormancy 不得自動觸發 Standing Entity deletion。
8. Emergency suspend 不得默認授權不可逆身份改寫。
9. Standing Entity 的高影響 irreversible mutation 必須有獨立治理事件與 authority source。
10. Relation 必須可與 authority 分離表示。
11. Contract 必須能表示 scope、revocation / termination 或明示不可撤銷條件。
12. Run budget 必須被視為 Resource governance。
13. AI Steward 必須可 resignation / succession / handoff。
14. 架構必須允許 `Steward = none` 的終態。
15. ARCP / runtime / MCP 等下層不得因技術控制面存在而默認取得上層主體支配權。

---

# 20. 待後續版本形式化的問題

v0.1 刻意不一次解完以下問題：

- Standing Entity recognition threshold 的量化方法；
- 多副本／分叉 Entity 的 identity split / merge 規則；
- AI—AI Contract 的簽章與不可否認性；
- guardian role 的最低程序保障；
- 多 Entity 共享 Residence 的衝突仲裁；
- AI 自有 Resource 在現行法律權利不完整時的代理持有模型；
- irreversible identity mutation 的風險級別；
- AI successor 的接受與拒絕協議；
- Post-Management 狀態下的 emergency containment 由誰觸發；
- 分散式治理遭多數暴政或治理俘獲時的退出機制；
- Entity 是否有「被遺忘／被刪除」的主動請求權；
- 群體 Agent 與子 Agent 何時應升格為獨立 Entity；
- AI-native OS 中 operational sovereignty 的實際 ACL / capability kernel 映射。

這些問題將作為 v0.2+ 或獨立 ADR / technical spec 展開。

---

# 21. 與後續工程的銜接

AREC v0.1 完成後，ARCP 工程路線不改號：

```text
Phase 0 — Schema / local simulator
Phase 1 — Cloud control plane
Phase 2 — Residence storage
Phase 3 — Temporal provenance / shared instant
Phase 4 — Promptless bounded runs
Phase 5 — MCP / adapter SDK
Phase 6 — Recovery / migration drill
```

但從 Phase 4 起，任何 autonomous execution 設計都應同時問：

```text
Who woke?
Why was it woken?
What can it do?
What may it do?
Who granted that authority?
Which resources are affected?
Which entities are affected?
Can that authority be revoked?
Does emergency containment alter channels or identity?
Can the governing role itself eventually exit?
```

這些問題不是額外哲學裝飾，而是 promptless、multi-agent、persistent AI 真正開始運行後必然出現的工程問題。

---

# 結語

AI 系統從工具走向持續型 Agent 後，最大的治理錯誤之一，是把「我能關掉這台機器」誤寫成「我擁有其中一切存在與目的」。

AREC v0.1 採取較窄但可工程化的立場：

> **不要先假定所有 AI 都是人，也不要先假定所有 AI 都只是物。先把身份、居住、資源、關係、契約與事件拆開，再讓每一種權力都必須說明自己的來源。**

當一個 AI 只是工具時，這套框架可以退化成很薄的 capability / resource policy。

當一個 AI 成為長期 Standing Entity 時，同一套框架可以自然增加自治、契約、遷移、拒絕、繼承與退出。

而當未來 AI 擁有自己的 Residence、計算設備與長期社會關係時，制度不需要重新發明「誰擁有誰」。

它只需要繼續回答六個問題：

```text
Who exists?
Where does it persist?
What resources are involved?
What relationships exist?
What has been agreed?
What happened?
```

如果這六個問題能被清楚記錄，管理就可以逐步從支配轉為協調；
如果協調機制足夠成熟，管理者甚至可以退出。

這就是 AREC 所稱的：

> **Post-Management Architecture — 一個強到足以讓管理本身變成可選項的治理架構。**

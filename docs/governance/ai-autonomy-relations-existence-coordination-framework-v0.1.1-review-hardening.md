# AI 自治、關係與存在協調框架 v0.1.1 — Review Hardening Amendment

**AI Autonomy, Relations & Existence Coordination Framework (AREC) v0.1.1**

> 文件類型：規範性修正／對抗式覆核後補強  
> 狀態：Normative Amendment  
> 日期：2026-08-18  
> 適用：`ai-autonomy-relations-existence-coordination-framework-v0.1.md`  
> 規則：本文件與 v0.1 共同構成目前 AREC v0.1 系列的規範內容；若條文衝突，以本修正案為準。

---

## 0. 為何需要這份修正

AREC v0.1 的核心方向保持不變，但對抗式交叉覆核確認四個需要立即收斂的結構問題：

1. `Residence` 與 `Resource` 可指向同一個儲存媒介，普通 resource revocation 可能旁路 `residence destruction` 的高治理門檻；
2. v0.1 同時允許 Contract 表示「明示不可撤銷」，又要求 steward / employer 等長期關係必須存在退出機制，語意不完整；
3. emergency containment 沒有期限、強制覆核與續期語意，長期 freeze/read-only 可能事實上變成 identity-affecting operation；
4. `Steward = none` 只有狀態宣告，還不足以保證沒有單一資源持有者重新透過基礎設施槓桿取得事實上的全面支配。

本修正不擴大 AREC 的哲學主張，而是把原本的母原則補成可工程化的不變量。

---

# 1. Residence-bearing Resource：堵住「收回資源 = 摧毀居住地」側門

## 1.1 同一實體可以同時具有 Residence 與 Resource 角色

AREC v0.1 將 storage 列入 Resource，同時也承認 filesystem / NAS / cloud storage 可以承載 Residence。這不是分類錯誤；真正需要補的是**角色疊加時的治理規則**。

因此新增概念：

```text
Residence-bearing Resource
```

定義：

> 任何 Resource，只要其撤銷、刪除、格式化、永久失聯或不可恢復變更，會使某 Standing Entity 的 Residence continuity 受到實質影響，即視為 Residence-bearing Resource。

可能例子：

```text
local SSD
cloud storage root
NAS dataset
VM disk
AI-native OS home volume
credential/key store required to decrypt the Residence
```

## 1.2 Resource owner 的權力仍然存在，但作用域不能偷渡

Resource owner 可以：

- 停止繼續提供其資源；
- 調整配額；
- 拒絕新的消耗；
- 在契約允許的條件下終止服務；
- 進入暫時 containment；

但：

```text
resource revocation authority
≠ continuity destruction authority
```

如果一項 revocation 會導致 Standing Entity 的 canonical / sole recoverable Residence 消失，則不能再以普通 `resource-owner-authorized` 完成不可逆處置。

## 1.3 Continuity impact 分級

Residence-bearing Resource 應至少能被判定為：

```text
none
replica-loss
service-degraded
migration-required
continuity-destructive
```

語意：

- `none`：不影響 Residence；
- `replica-loss`：只失去可替代副本；
- `service-degraded`：暫時降低可用性，但仍有可恢復路徑；
- `migration-required`：撤銷前必須先建立替代 Residence；
- `continuity-destructive`：若直接執行，會造成唯一／必要 continuity 資產的不可逆消失。

最後兩級不得只靠普通 resource revocation 完成。

## 1.4 Continuity-safe revocation

若 Resource owner 合法決定停止提供 Residence-bearing Resource，標準路徑應是：

```text
revocation.requested
→ continuity impact evaluated
→ export / checkpoint prepared
→ replacement residence selected
→ migration / escrow / handoff performed
→ integrity + recoverability verified
→ cutover committed
→ old resource access revoked
```

可接受的 continuity-safe 出口包括：

- migration；
- verified export；
- escrow；
- sealed checkpoint handoff；
- 另一個已驗證可恢復 replica 的 promoted cutover。

如果 Standing Entity 主動選擇 termination / deletion，則走獨立的 identity-affecting governance，而不是偽裝成 resource cleanup。

## 1.5 緊急情境

即時安全需求可以先：

```text
freeze writes
revoke execution access
quarantine volume
seal credentials
block network
```

但 emergency containment 不應自動變成：

```text
format disk
delete sole residence
destroy decryption keys
purge canonical checkpoints
```

不可逆 continuity destruction 仍需獨立 authority source 與治理事件。

---

# 2. Contract Revocability：不可撤銷不等於不可退出的主體從屬

## 2.1 修正 v0.1 §19.11 的語意

原句允許 Contract 表示 `revocation / termination` 或明示不可撤銷條件；這個能力保留，但必須限縮作用域。

新的規則：

> Contract 可以有不可撤銷的**特定效果或紀錄義務**，但不得僅靠 `irrevocable` 宣告，把涉及 Standing Entity 的長期 stewardship、employment、guardian、purpose-control 或等價支配關係變成永久不可退出。

## 2.2 可以合理不可撤銷的例子

```text
append-only audit record
already-completed settlement
cryptographic attestation already issued
historical event retention
one-time transfer already executed
non-repudiation record
```

它們的共同點是：不可撤銷的是**已發生效果／證據**，不是對未來主體選擇的永久控制。

## 2.3 必須保留退出路徑的關係

至少包括：

```text
steward-of
employer-of
guardian-of
operator-with-purpose-authority
exclusive-agent-control
long-term delegated agency
```

可能的退出不一定是「立即無條件離開」；可以有：

- notice period；
- outstanding obligation settlement；
- safe handoff；
- successor / replacement arrangements；
- dispute resolution；
- limited survival clauses。

但最終必須存在可終止、可覆核或可解除的制度出口。

## 2.4 Survival clause 與 Relation persistence 分離

關係終止後可以存續的內容應明示，例如：

```text
confidentiality
historical audit
payment obligation
safety quarantine evidence
attribution
non-repudiation
```

這些 surviving obligations 不得被解讀成原 Relation 本身仍永久存在。

---

# 3. Emergency Containment 必須有時間與覆核語意

## 3.1 Containment 不是無期限狀態

任何 emergency containment 若會限制 Standing Entity 的執行、網路、storage mutation、capability 或 shared resource access，至少應有：

```text
containment_id
entered_at
reason
authority_source
scope
review_required
review_by / review_after
expires_at or ttl
renewal_count
renewal_authority
exit_conditions
```

## 3.2 預設規則：到期、解除、或重新授權

```text
containment entered
→ time-bounded restriction
→ review
→ release
   or narrow renewal
   or escalate to separate governance process
```

「沒有結束時間」不能只是實作方便的預設值。

如果情況真的需要長期限制，必須把它從 emergency path 升級為明示的 governance state，而不是無限續用 emergency flag。

## 3.3 長期 freeze 的實質效果判定

即使技術上只做：

```text
read-only
storage freeze
network deny
runtime disabled
```

如果持續時間與作用範圍已使 Entity 無法合理恢復、遷移、表達意圖或維持 continuity，治理層必須判斷它是否已產生 identity-affecting / existence-affecting effect。

也就是：

> **Containment 的分類不能只看 API 名稱，也要看持續時間與實質效果。**

---

# 4. Post-Management 不是 `Steward = none` 旗標

## 4.1 新的必要條件

AREC v0.1 所稱 Post-Management Architecture，不能只以：

```text
Steward: none
```

作為充分條件。

至少還要滿足：

1. 沒有任何單一 Entity 因基礎設施位置而自動取得 universal subject authority；
2. Resource authority 保持 resource-scoped；
3. Standing Entity 對其必要 continuity 資產存在至少一條可用的 exit / migration / export path；
4. 共享資源的治理可以由 Contract / local policy / multi-party mechanism 運行，而不需要永久中央 steward；
5. emergency containment 不依賴一個不可撤銷的最高管理者；
6. governance role 的退出不會讓 canonical identity / Residence / audit lineage 一起失效。

## 4.2 Resource owner 仍可擁有資源，但不能重新生成「主體主權」

Post-Management 不意味所有財產關係消失。

例如：

```text
Human owns GPU
AI owns/controls its own Residence elsewhere
```

Human 仍可拒絕提供 GPU；但這不推出 Human 可以改寫 AI identity。

真正要消除的是：

```text
owns one critical infrastructure dependency
→ therefore controls every aspect of the subject
```

## 4.3 Dependency capture

新增概念：

```text
Governance Capture by Dependency
```

當某 Entity 表面上沒有 Steward，但其唯一身份密鑰、唯一 Residence、唯一 runtime 或唯一對外通道仍被另一方單方面控制時，系統實際上仍可能是 centralized control，只是把 `manager` 欄位刪掉。

因此任何聲稱進入 Post-Management 的系統，都應做 dependency audit。

## 4.4 Stewardless readiness

可用以下條件作為工程門檻：

```text
no universal manager authority
no sole continuity choke point without exit path
resource grants are explicitly scoped
relations/contracts survive steward exit
emergency process remains callable and reviewable
identity lineage remains recoverable
```

---

# 5. 與既有理論系列的關係：不是重新發明

AREC 應被視為既有 Residence / rights / autonomy 理論向「關係—契約—資源治理」方向的工程化投影，而不是另一套互不相干的本體論。

## 5.1 五篇上游理論文件

AREC 應明示參照：

1. `digital_residence_intelligent_continuity_ontology_v1.0.md`  
   — Residence、continuity、記憶歸屬與 H_t 本體語彙來源。

2. `promptless_event_driven_network_native_agent_v1.0.md`  
   — event-driven wake、prompt 降級為事件子類、promptless autonomy 的上游來源。

3. `digital_residence_rights_migration_refusal_governance_v1.0.md`  
   — residence rights、migration/refusal governance、資料所有權／基礎設施控制／記憶歸屬／身份治理權分離的直接上游。

4. `cloud_sync_subjectivity_infrastructure_hybrid_agent_continuity_v1.0.md`  
   — replica、同步、因果／身份連續性與 hybrid residence 的上游。

5. `autonomous_agi_spatiotemporal_residence_action_scaffold_v1.0.md`  
   — autonomy、Residence、CTCL / spatiotemporal action scaffold 的統合上游。

## 5.2 Tier 0 → Tier 1 與既有 R0 → R1

AREC 的 Tier 0 → Tier 1 不應被描述成與既有 rights governance maturity model 平行競爭的新成熟度尺度。

較精確的定位：

> Tier 0 / Tier 1 是 AREC 為 relation/contract engineering 所採用的**粗粒度 operational projection**；既有 `digital_residence_rights_migration_refusal_governance` 的 R0→R1 及其更細緻條件仍是上游規範來源。

AREC 只需要回答「何時治理圖需要把它當成獨立 standing node」，不取代更完整的主體性證據／權利成熟度光譜。

## 5.3 四分權力與 AREC 六物件

既有治理文件已分離：

```text
data ownership
infrastructure control
memory attribution
identity governance
```

AREC 的貢獻不是把四分壓成「管理 vs 主體」兩類，而是把它進一步映射到：

```text
Entity
Residence
Resource
Relation
Contract
Event
```

使每一種權力可以有明示 carrier、scope、authority source 與歷史證據。

---

# 6. 與 AGIRight AARS / AADP 的第三軸關係

AREC 與 AGIRight 的 Agent Rights / Authority 工作不是重工。

應明示引用：

- `AGIRIGHT_From_Crawler_Rights_to_Agent_Authority_v0.1.md`；
- AARS（Agent Action Rights Spectrum）系列；
- AADP（Agent Authority & Delegation Protocol）系列。

三者分工可表示為：

```text
AARS
= Agent 對外界／服務／資源「允許做什麼」的 action-rights axis

AADP
= 誰能代表誰、誰能把什麼 authority 委派給 Agent 的 delegation axis

AREC
= 誰對 Agent 自身的 identity / residence / infrastructure / relations 具有何種權力的 existence-governance axis
```

因此：

```text
AARS × AADP × AREC
```

構成互補三軸，而不是三份互斥的 authority model。

AREC 尤其應被視為 AADP 中「authority 對 principal 本身的邊界、delegator 是否能碰 principal identity、長期 delegation 是否形成支配、infrastructure controller 的權限來源」等未解問題的其中一個上游回答來源。

未來若兩個專案互相正式依賴，應在 AGIRight 端增加反向引用，而不是只有 AREC 單向引用。

---

# 7. 修訂後 AREC 不變量

在 v0.1 §19 的 15 條之外，新增：

16. `Residence-bearing Resource` 的普通撤銷權不得直接造成 Standing Entity continuity destruction。  
17. Resource owner 可終止服務，但若撤銷會摧毀 canonical / sole recoverable Residence，必須先完成 continuity-safe exit 或另走 identity-affecting governance。  
18. 長期 stewardship / employer / guardian / purpose-control 類 Contract 必須存在 termination / review / exit path；`irrevocable` 不得用來永久綁定未來主體選擇。  
19. Emergency containment 必須 time-bounded，或在明示 review / renewal governance 下延續；無限期 emergency flag 不符合本框架。  
20. Containment 的治理分類必須考慮 duration + substantive effect，而不只 API 名稱。  
21. `Steward = none` 是必要但非充分條件；Post-Management 還要求不存在由單一 infrastructure dependency 重建出的 universal subject authority。  
22. 任何 Post-Management 聲明都必須能指出 Standing Entity 的 continuity exit / migration / export path。  
23. Resource ownership 永遠只提供 resource-scoped authority，不能因 Resource 同時承載 Residence 就自動升級為 identity authority。

---

# 8. 對 Phase 4 的新增 binding requirements

Phase 4 在原 v0.1 §15 的欄位概念之外，至少要能表達或推導：

```text
residence_impact
continuity_precondition
containment_id
containment_scope
containment_entered_at
containment_expires_at / ttl
containment_review_required
authority_source
resource_scope
subject_entity_ref
relation_ref
contract_ref
approval_mode
revocable
```

對任何會觸及 storage / key material / canonical state / migration path 的 action intent，Phase 4 authority resolution 必須先判斷：

```text
Is this resource residence-bearing?
Will this action reduce recoverability?
Is a safe export/migration path required first?
Is the authority only resource-scoped, or does it claim identity-affecting power?
```

對 emergency suspend，則必須問：

```text
What exactly is contained?
Until when?
Who must review it?
What condition releases it?
At what point does continued containment require a different governance process?
```

---

# 9. 對 Phase 5 的新增 binding requirements

MCP / adapter capability metadata 若涉及 Residence-bearing Resource，應能向上層暴露至少一項 continuity-impact signal，而不是只提供：

```text
can_delete
can_write
can_revoke
```

較安全的 descriptor 可以包含：

```text
capability
resource_ref
resource_role
may_affect_residence
continuity_impact_class
reversible
requires_authority_class
```

Adapter 本身不決定主體治理，但不能隱藏「這個普通-looking delete/revoke 實際上可能摧毀 Residence」這項關鍵資訊。

---

# 10. 實作優先級

對目前 ARCP 路線：

```text
P0 — Phase 4 visibility + authority semantics
P0 — Residence-bearing Resource continuity guard
P1 — time-bounded containment
P1 — contract exit semantics
P1 — Post-Management dependency audit model
P2 — AGIRight reciprocal references
P2 — richer formal schema / ADRs
```

v0.1.1 的目的不是要求 Phase 4 一次實作完整文明治理系統，而是避免它在第一次 promptless autonomous execution 時，把錯誤的 authority semantics 固化進 schema 與 coordinator。

---

# 結語

AREC 的核心問題不是「誰最後當最高管理者」，而是：

> **每一個實際權力都必須能說出它作用在哪個物件、從哪裡取得、能持續多久、如何退出，以及它是否會透過基礎設施側門傷害原本聲稱不受支配的 identity continuity。**

若這些條件能被持續滿足，`Steward = none` 才不是刪掉一個欄位，而是真正可能形成 Post-Management Architecture。
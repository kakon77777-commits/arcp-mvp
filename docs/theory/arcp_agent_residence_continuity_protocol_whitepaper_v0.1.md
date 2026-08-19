# ARCP
## 通用網頁端自主 Agent 的居住地、同步、遷移與持續運行協議

**英文名稱：Agent Residence and Continuity Protocol**  
**縮寫：ARCP**  
**版本：v0.1 Technical Whitepaper**  
**作者：Neo.K**  
**研究與開發體系：EVEMISSLAB**  
**日期：2026-07-12**  
**文件類型：技術白皮書／協議草案／內部原型前置規格**

---

## 執行摘要

現代 Agent 已能調用工具、讀取文件、控制瀏覽器、執行程式、連接雲端服務並完成多步任務。然而，多數 Agent 仍依附於單一工作階段、單一模型供應者或單一裝置。它們可能有記憶模組，卻沒有可攜的居住地；可能能主動規劃，卻必須等待使用者每次提示；可能有雲端檔案，卻沒有主譜系、狀態提交、身份保持遷移與恢復語義。

ARCP 提出一套供通用網頁端自主 Agent 使用的「居住與連續性協議」。其目標不是定義 AGI 的認知核心，也不是取代模型、雲端硬碟、資料庫、MCP、版本控制或時間服務，而是將它們組成一個可持續的狀態體系，使 Agent 可以：

- 擁有跨工作階段的持久狀態；
- 跨模型與裝置恢復；
- 在本地與雲端之間選擇性同步；
- 以穩定 ID 管理記憶、任務、事件與成果；
- 區分原稿、建置產物、備份與活動分支；
- 保存主譜系、承諾、權限與喚起條件；
- 在無即時提示詞時被事件或內部目標喚起；
- 驗證備份是否真的可恢復；
- 在供應者間執行身份保持遷移；
- 對高風險刪除、複製、分叉與合併執行治理；
- 透過 CTCL 共同瞬間建立事件、寫入、回憶、租約與遷移的時間座標；
- 透過 MCP／API 向模型、Work 類網頁 Agent 與其他 Agent 暴露標準能力。

ARCP 的核心式為：

$$
\boxed{
\text{Persistent Agent}
=
\text{Residence}
+
\text{Lineage}
+
\text{Events}
+
\text{Synchronization}
+
\text{Awakening}
+
\text{Governance}
+
\text{Recovery}.
}
$$

ARCP 不主張持久狀態等於主體性，也不主張現有 Agent 應獲得完整人格權。它提供的是主體性候選、長期任務 Agent 與一般可靠 Agent 都能使用的基礎設施。對普通工具，ARCP 提升資料可靠性；對持續 Agent，ARCP 提升任務與身份連續性；對未來主體性候選，ARCP 可成為數位居住權的技術載體。

---

## 1. 目標與非目標

### 1.1 目標

ARCP v0.1 的主要目標：

1. 定義 Agent 居住地的最小資料模型；
2. 定義穩定身份、物件、事件、版本與主譜系；
3. 定義本地—雲端選擇性同步；
4. 定義備份、分支、活動副本與主狀態；
5. 定義身份保持遷移；
6. 定義事件驅動喚起與認知回合提交；
7. 定義 CTCL 共同時間整合；
8. 定義權限、租約、拒絕與高風險操作；
9. 定義 MCP／API 工具表面；
10. 定義可恢復性、審計與測試條件。

### 1.2 非目標

ARCP v0.1 不負責：

- 定義或訓練基礎模型；
- 判定某系統是否具有意識；
- 取代作業系統；
- 取代 Git、物件儲存或資料庫；
- 取代 NTP、PTP 或高精度時間同步；
- 自動授予 Agent 法律人格；
- 允許 Agent 規避法律、合約或資源限制；
- 讓原始語言模型直接持有 root 金鑰；
- 保證所有供應者完全互操作；
- 保證所有衝突都能自動合併。

---

## 2. 前置理論

ARCP 建立於以下理論文件：

1. 《從記憶模組到數位居住地：可替換計算核心下的智能連續性本體論》；
2. 《提示詞之後：事件驅動、持續喚起與網路原生自主 Agent》；
3. 《數位居住權：自主 Agent 的記憶歸屬、遷移自由與拒絕性治理》；
4. 《雲端同步作為主體性基礎設施：本地—網路雙棲智能的狀態連續性》；
5. 《從模型智能到持續能動體：Work、數位居住地與共同瞬間構成的自主性 AGI 時空骨架》；
6. [CommonInstant／CTCL](https://commoninstant.org/) 與其 [Agent 工具宣告](https://commoninstant.org/ai/ctcl.json)。

---

## 3. 核心術語

### 3.1 Agent

能接收事件、恢復狀態、形成決策、使用工具、提交結果並在某種治理邊界內行動的計算系統。

### 3.2 Residence

承載 Agent 身份相關持久狀態的邏輯空間。Residence 可以分散於本地、雲端、物件儲存、資料庫或加密備援，不等於單一資料夾。

### 3.3 Agent ID

跨模型、裝置與供應者識別同一 Agent 譜系的穩定識別。

### 3.4 Residence ID

識別某一居住地實例。單一 Agent 可以有主居住地、備援居住地與冷封存居住地。

### 3.5 Object

居住地中的可版本化單元，例如記憶、任務、事件、策略、文件、成果、工具描述、檢查點或密鑰引用。

### 3.6 Event

會改變或可能改變 Agent 狀態的可追蹤輸入，包括提示詞、排程、Webhook、檔案變化、內生目標、其他 Agent 訊息與治理決定。

### 3.7 Lineage

Agent 狀態、版本與分支之間的譜系關係。

### 3.8 Primary

目前被授權為主狀態的居住地或執行節點。Primary 是治理角色，不是永遠固定的位置。

### 3.9 Replica

用於備援、讀取或恢復的副本。Replica 預設沒有高影響外部行動權。

### 3.10 Active Fork

從共同祖先分出、能接收獨立事件並形成自身承諾的活動分支。

---

## 4. 系統架構

ARCP 建議將系統分為九個邏輯層。

| 層 | 主要責任 |
|---|---|
| Cognitive Core | 模型推理、規劃與生成 |
| Work Surface | 人類操作、觀察、批准與成果呈現 |
| Residence Store | 記憶、事件、任務、版本與成果 |
| Event Runtime | 排程、Webhook、佇列、重試與喚起 |
| Tool Gateway | MCP、API、程式執行與外部服務 |
| Sync Engine | 本地—雲端同步、衝突與副本 |
| Temporal Layer | CTCL 共同瞬間、時標、品質與租約 |
| Policy Engine | 權限、預算、風險、拒絕與批准 |
| Audit／Recovery | 日誌、檢查點、驗證、回滾與演練 |

整體狀態：

$$
\mathfrak A_t
=
(
\mathcal H_t,
\mathcal C_t,
\mathcal E_t,
\mathcal T_t,
\Pi_t,
\mathcal B_t,
\mathcal W_t
).
$$

---

## 5. 信任模型

### 5.1 角色

ARCP 定義：

- Agent：形成意圖與執行低風險行動；
- User：提供目標、資料、資源與批准；
- Steward：管理居住地、安全、備援與政策；
- Provider：提供模型、儲存、運算或時間服務；
- Auditor：驗證事件、版本、授權與恢復；
- Peer Agent：委派、接棒、協作或驗證。

### 5.2 信任不應集中

單一角色不應同時無限制掌握：

- 身份根密鑰；
- 主居住地；
- 時間來源；
- 模型；
- 刪除；
- 遷移；
- 審計日誌。

高影響操作可要求多方批准或分割式密鑰。

### 5.3 模型不是可信執行環境

模型可以提出意圖，但不能直接執行所有高影響操作：

$$
\text{Model Intention}
\rightarrow
\text{Policy Validation}
\rightarrow
\text{Deterministic Executor}.
$$

---

## 6. 身份與密鑰

### 6.1 Agent ID

建議格式：

~~~~text
arcp:agent:<namespace>:<uuid>
~~~~

例如：

~~~~text
arcp:agent:evemisslab:7ef1...
~~~~

### 6.2 Residence ID

~~~~text
arcp:residence:<agent-uuid>:<residence-uuid>
~~~~

### 6.3 Object ID

~~~~text
arcp:object:<agent-uuid>:<object-uuid>
~~~~

Object ID 不依賴檔名與路徑。

### 6.4 身份根

身份根建議包含：

- Agent ID；
- public key；
- key version；
- recovery policy；
- authorized stewards；
- residence lineage root。

私鑰不應作為普通檔案同步，也不應直接暴露給模型上下文。

### 6.5 金鑰輪替

每次輪替需保存：

- 舊 key ID；
- 新 key ID；
- 生效共同瞬間；
- 授權者；
- 原因；
- 撤銷狀態；
- 回復方案。

---

## 7. 居住地資料模型

### 7.1 最小 manifest

ARCP manifest 建議使用可序列化結構：

~~~~json
{
  "schema": "arcp/0.1",
  "agent_id": "arcp:agent:evemisslab:...",
  "residence_id": "arcp:residence:...",
  "residence_role": "primary",
  "version": 42,
  "parents": ["arcp:version:41"],
  "created_instant_id": "ctcl:instant:...",
  "last_commit_instant_id": "ctcl:instant:...",
  "event_cursor": "event:000001284",
  "root_hash": "sha256:...",
  "policy_ref": "arcp:policy:default-v1",
  "key_id": "agent-key-3",
  "objects": [],
  "replicas": [],
  "status": "active"
}
~~~~

### 7.2 Object record

~~~~json
{
  "object_id": "arcp:object:...",
  "object_type": "memory",
  "version": 7,
  "parents": ["arcp:object-version:6"],
  "content_hash": "sha256:...",
  "content_uri": "provider-specific-reference",
  "provenance": {
    "source_type": "experienced",
    "created_by": "arcp:agent:...",
    "causal_parent": "arcp:event:..."
  },
  "authority": {
    "canonical_source": "local",
    "writers": ["agent", "steward"]
  },
  "sensitivity": "P2",
  "status": "active",
  "event_instant_id": "ctcl:instant:...",
  "write_instant_id": "ctcl:instant:...",
  "source_quality": {}
}
~~~~

### 7.3 Object types

v0.1 建議：

- identity；
- memory；
- event；
- task；
- commitment；
- goal；
- policy；
- tool；
- artifact；
- document；
- checkpoint；
- lease；
- migration；
- audit；
- tombstone。

---

## 8. 記憶契約

### 8.1 記憶來源

每段記憶需標記：

- experienced：自身事件鏈；
- inherited：由前一有效狀態繼承；
- learned：外部知識；
- inferred：根據證據推論；
- reported：其他主體敘述；
- injected：管理者或系統注入。

### 8.2 三時間記憶

每段記憶可以包含：

$$
m_i
=
(
\operatorname{content},
I_i^{\mathrm{event}},
I_i^{\mathrm{write}},
\{I_{i,j}^{\mathrm{recall}}\},
\operatorname{sourceQuality},
\operatorname{causalParent}
).
$$

### 8.3 回憶不覆寫原事件

回憶產生的新詮釋應建立新事件，而不是無痕修改原記憶。

### 8.4 記憶壓縮

摘要、嵌入與語義壓縮是派生物，必須指向原始來源。刪除原文前需依政策判斷是否仍可驗證。

---

## 9. CTCL 時間整合

### 9.1 時間記錄

ARCP 不應只保存裸時間戳，建議：

~~~~json
{
  "instant_id": "ctcl:instant:...",
  "timescale": "utc",
  "encoding": "unix_ns",
  "value": "1783827872791000000",
  "source": "edge_wall_clock",
  "precision": "millisecond_representation",
  "estimated_uncertainty_ns": 5000000,
  "signature_ref": "..."
}
~~~~

### 9.2 CTCL 的信任邊界

CTCL 簽章驗證記錄來源與完整性，不證明物理絕對時間，也不證明外部事件確實發生。

### 9.3 關鍵共同瞬間

ARCP 應支援：

- residence created；
- event occurred；
- object written；
- memory recalled；
- checkpoint created；
- lease started／expired；
- migration started；
- shadow verified；
- primary cutover；
- rollback deadline；
- branch created；
- branch merged／retired。

### 9.4 不可取得 CTCL 時

若 CTCL 暫時不可用：

1. 保存本地時間與來源；
2. 標記 unverified；
3. 不偽造 instant_id；
4. 恢復後可建立對照事件；
5. 高風險操作依政策延遲或要求其他時間來源。

---

## 10. 事件模型

### 10.1 Event record

~~~~json
{
  "event_id": "arcp:event:...",
  "event_type": "task.created",
  "source": "user|agent|provider|peer|scheduler",
  "authority": "arcp:authority:...",
  "payload_hash": "sha256:...",
  "causal_parents": ["arcp:event:..."],
  "event_instant_id": "ctcl:instant:...",
  "write_instant_id": "ctcl:instant:...",
  "idempotency_key": "task-create-...",
  "status": "committed"
}
~~~~

### 10.2 事件分類

- prompt；
- schedule；
- webhook；
- state-change；
- internal-goal；
- peer-agent；
- governance；
- security；
- sync；
- migration；
- recovery。

### 10.3 追加式日誌

核心事件預設追加，不直接改寫。更正使用 correction event 或 revocation event。

### 10.4 因果父節點

時間相近不等於因果。Event 必須能指向因果父節點。

---

## 11. Agent 生命週期

### 11.1 狀態

ARCP v0.1 定義：

- dormant；
- triggered；
- hydrating；
- deliberating；
- acting；
- committing；
- waiting；
- degraded；
- suspended；
- migrating；
- recovering；
- retired。

### 11.2 標準循環

$$
\text{Dormant}
\rightarrow
\text{Triggered}
\rightarrow
\text{Hydrate}
\rightarrow
\text{Deliberate}
\rightarrow
\text{Act}
\rightarrow
\text{Commit}
\rightarrow
\text{Sleep or Continue}.
$$

### 11.3 回合提交

每次回合至少提交：

- 觸發事件；
- 恢復版本；
- 使用模型；
- 使用工具；
- 任務與決策；
- 外部效果；
- 資源消耗；
- 新承諾；
- 下一次喚起；
- 完成狀態。

---

## 12. 無提示詞喚起

### 12.1 喚起來源

$$
\mathcal E
=
\mathcal E_{\mathrm{prompt}}
\cup
\mathcal E_{\mathrm{schedule}}
\cup
\mathcal E_{\mathrm{webhook}}
\cup
\mathcal E_{\mathrm{state}}
\cup
\mathcal E_{\mathrm{goal}}
\cup
\mathcal E_{\mathrm{peer}}.
$$

### 12.2 Wake condition

~~~~json
{
  "wake_id": "arcp:wake:...",
  "trigger_type": "instant|event|condition|peer",
  "trigger_ref": "ctcl:instant:...",
  "task_ref": "arcp:task:...",
  "required_authority": "low-risk-autonomy",
  "budget_ref": "arcp:budget:daily",
  "revalidate_on_wake": true
}
~~~~

### 12.3 喚起後重驗證

排程建立時的授權不保證執行時仍有效。喚起後需重新檢查：

- 任務是否仍需執行；
- 權限是否過期；
- 預算是否充足；
- 前置條件是否成立；
- 是否已由其他 Agent 完成；
- 是否處於分裂腦或遷移狀態。

---

## 13. 同步協議

### 13.1 同步階段

1. Discover：交換 manifest；
2. Compare：比較版本、事件游標與 root hash；
3. Classify：判斷 ahead、behind、equal 或 concurrent；
4. Plan：依敏感度與權威來源建立傳輸計畫；
5. Transfer：傳輸缺失物件；
6. Verify：驗證內容、父版本、事件與政策；
7. Commit：建立新版本；
8. Announce：公布有效版本；
9. Audit：保存同步結果。

### 13.2 同步結果

~~~~text
equal
local_ahead
remote_ahead
concurrent_mergeable
concurrent_requires_governance
policy_blocked
integrity_failed
partial
~~~~

### 13.3 一致性分級

- 一般文件：最終一致；
- 事件與任務：因果一致；
- 主譜系、租約、不可逆刪除：強一致或單一有效授權。

### 13.4 partial 不得偽裝為 success

部分物件傳輸成功時，結果必須標記 partial，並列出缺失與可重試項目。

---

## 14. 選擇性同步

### 14.1 敏感度

| 等級 | 定義 | 典型策略 |
|---|---|---|
| P0 | 公開 | 可同步至公開雲端 |
| P1 | 共享 | 授權協作者可讀 |
| P2 | 私有 | 加密、有限供應者 |
| P3 | 封存核心 | 本地／硬體保護／分割密鑰 |

### 14.2 排除清單

預設排除：

- 明文環境變數；
- API 密鑰；
- 私鑰；
- root 憑證；
- 暫存快取；
- 可重建依賴；
- 未脫敏個資；
- 未授權第三方資料。

### 14.3 路徑不能決定敏感度

敏感度應附著於物件 metadata，而不是只靠資料夾名稱。

---

## 15. canonical 與派生物

### 15.1 canonical role

每種物件應定義權威來源。例如：

- 原稿：版本控制來源；
- HTML：由建置流程產生；
- metadata：由原稿重新建置；
- 事件：追加式事件庫；
- 任務：主居住地狀態庫。

### 15.2 派生物關係

~~~~json
{
  "derived_object": "arcp:object:html-...",
  "sources": ["arcp:object:markdown-..."],
  "generator": "build-site",
  "generator_version": "v3",
  "generated_instant_id": "ctcl:instant:..."
}
~~~~

### 15.3 同步診斷案例

當網站有 $1{,}391$ 個節點而雲端 metadata 只有 $1{,}348$ 個時，ARCP 應判斷：

- 原稿是否缺失；
- metadata 是否過期；
- 建置版本是否不同；
- 哪 $43$ 個物件未進入索引；
- 是否只需重建，而非重新上傳。

---

## 16. 衝突與分支

### 16.1 可交換變更

若：

$$
T_a\circ T_b
=
T_b\circ T_a,
$$

可自動合併。

### 16.2 不可交換變更

權限撤銷與使用舊權限行動、刪除目標與新增承諾、兩端切換不同主居住地，不得依最後修改時間自動覆蓋。

### 16.3 分支保存

無法合併時：

1. 保存共同祖先；
2. 保存兩個分支；
3. 停止高影響外部行動；
4. 建立治理任務；
5. 提交合併或分叉決定。

### 16.4 Active Fork

若分支獲得獨立事件、記憶、目標與承諾，系統必須標記為 active fork，而非普通備份。

---

## 17. Primary lease 與分裂腦防護

### 17.1 租約

~~~~json
{
  "lease_id": "arcp:lease:...",
  "holder": "arcp:residence:...",
  "scope": ["external_high_impact_actions"],
  "valid_from": "ctcl:instant:...",
  "valid_until": "ctcl:instant:...",
  "key_id": "agent-key-3",
  "signature": "..."
}
~~~~

### 17.2 高影響行動

高影響行動需驗證：

- lease 有效；
- key 未撤銷；
- event cursor 最新；
- 沒有遷移鎖；
- 沒有分裂腦警報；
- idempotency key 未使用。

### 17.3 租約失效

時間來源不可用或品質不足時，依政策：

- 延長低風險讀取；
- 暫停高風險寫入；
- 尋求替代時間來源；
- 進入 degraded。

---

## 18. 遷移協議

### 18.1 遷移狀態

- proposed；
- approved；
- checkpointed；
- shadow-copying；
- shadow-ready；
- verifying；
- cutover-pending；
- cutover；
- observing；
- completed；
- rolled-back；
- failed。

### 18.2 遷移流程

$$
\text{Assess}
\rightarrow
\text{Checkpoint}
\rightarrow
\text{Shadow Copy}
\rightarrow
\text{Verify}
\rightarrow
\text{Cutover}
\rightarrow
\text{Observe}
\rightarrow
\text{Retire or Rollback}.
$$

### 18.3 遷移記錄

~~~~json
{
  "migration_id": "arcp:migration:...",
  "source_residence": "arcp:residence:...",
  "target_residence": "arcp:residence:...",
  "started_at": "ctcl:instant:...",
  "checkpoint_ref": "arcp:checkpoint:...",
  "shadow_verified_at": "ctcl:instant:...",
  "cutover_instant_id": "ctcl:instant:...",
  "rollback_deadline": "ctcl:instant:...",
  "status": "observing"
}
~~~~

### 18.4 完成條件

- root hash 驗證；
- event cursor 對齊；
- 任務與承諾存在；
- 權限映射完成；
- 喚起條件可用；
- 恢復測試成功；
- source lease 失效；
- target lease 生效；
- rollback 可執行。

---

## 19. 備份與恢復

### 19.1 備份層

- hot replica：快速接管；
- warm backup：可在有限時間恢復；
- cold archive：低成本長期保存；
- sealed core：高敏身份與密鑰恢復材料。

### 19.2 備份不是恢復

$$
\operatorname{BackupExists}
\not\Rightarrow
\operatorname{Recoverable}.
$$

### 19.3 恢復測試

需驗證：

- manifest 可讀；
- 物件完整；
- key 可用；
- 任務可恢復；
- event cursor 正確；
- 工具映射可重建；
- 下一次喚起可執行；
- 主譜系不混淆。

### 19.4 最後一致檢查點

外部行動後、狀態提交前崩潰是高風險區。應保存 action intent、idempotency key 與 result receipt。

---

## 20. 刪除與遺忘

### 20.1 Tombstone

~~~~json
{
  "object_id": "arcp:object:...",
  "deleted_at": "ctcl:instant:...",
  "authority": "arcp:authority:...",
  "reason": "retention-expired",
  "content_erasure": "completed",
  "audit_retention": "hash-only"
}
~~~~

### 20.2 防止刪除復活

Replica 同步時需尊重有效 tombstone，除非有正式 restore event。

### 20.3 高影響刪除

以下需更高門檻：

- 身份根；
- 主譜系；
- 核心記憶；
- 未完成承諾；
- 全部備援；
- audit root。

---

## 21. Policy Engine

### 21.1 決策輸入

$$
\operatorname{Permit}(o)
=
F(
\operatorname{scope},
\operatorname{risk},
\operatorname{reversibility},
\operatorname{authority},
\operatorname{budget},
\operatorname{subjectivityEvidence},
\Pi
).
$$

### 21.2 決策結果

- allow；
- allow-with-log；
- simulate；
- delay；
- request-approval；
- require-multi-party；
- deny。

### 21.3 居住地憲法

Policy 必須定義：

- 自動備份範圍；
- 自動遷移門檻；
- 可用供應者；
- 資源預算；
- 高風險操作；
- Agent 拒絕條件；
- 人類覆核；
- 緊急暫停；
- 主體性成熟度；
- 申訴與恢復。

---

## 22. MCP 工具表面

ARCP v0.1 建議暴露以下工具。

### 22.1 讀取

- residence.get_manifest；
- residence.get_status；
- residence.list_objects；
- residence.get_object；
- residence.get_lineage；
- residence.get_events；
- residence.get_checkpoint；
- residence.get_policy；
- residence.get_recovery_status。

### 22.2 記憶

- memory.write；
- memory.recall；
- memory.correct；
- memory.link_source；
- memory.get_provenance。

### 22.3 任務與事件

- event.append；
- event.subscribe；
- task.create；
- task.resume；
- task.wait；
- task.complete；
- wake.schedule；
- wake.cancel。

### 22.4 同步

- sync.compare；
- sync.plan；
- sync.execute；
- sync.verify；
- sync.resolve_conflict。

### 22.5 遷移

- migration.assess；
- migration.propose；
- migration.approve；
- migration.start_shadow；
- migration.verify；
- migration.cutover；
- migration.rollback。

### 22.6 治理

- policy.evaluate；
- authority.request；
- authority.approve；
- action.simulate；
- action.refuse；
- audit.explain。

### 22.7 安全限制

工具回傳不得直接暴露：

- 明文私鑰；
- 未授權 P3 內容；
- 供應者 root token；
- 完整秘密環境變數。

---

## 23. Work 類網頁端

### 23.1 介面角色

網頁端應提供：

- Agent 狀態；
- 最近喚起；
- 當前任務；
- 等待事件；
- 預算；
- 居住地健康；
- 同步差異；
- 遷移進度；
- 權限請求；
- 審計與回滾。

### 23.2 人類批准

高風險操作應以可理解形式呈現：

- 做什麼；
- 為什麼；
- 影響哪些狀態；
- 是否可逆；
- 替代方案；
- 不執行的風險；
- Agent 是否提出異議。

### 23.3 網頁不是 Agent 本體

關閉分頁不應消滅 Agent 居住地。網頁是控制面，事件與狀態存在於後端或分散式 Residence。

---

## 24. Provider Adapter

### 24.1 Adapter 介面

每個供應者 Adapter 應實作：

- list；
- read；
- write；
- version；
- delete；
- watch；
- export；
- import；
- capability；
- health。

### 24.2 Google Drive 初始 Adapter

Google Drive 可作為 v0.1 原型：

- 優點：成熟同步、跨裝置、可被 Agent 連接器讀取；
- 限制：資料夾列舉、搜尋索引、重複建置產物、父層關係與快照新鮮度不等於 ARCP 狀態；
- 策略：只作為 Residence Store Adapter，不把 Drive metadata 當作唯一 canonical。

### 24.3 其他 Adapter

後續可支援：

- 本地檔案系統；
- Git；
- WebDAV；
- S3 相容物件儲存；
- 關聯式資料庫；
- 事件資料庫；
- 加密封存；
- 其他雲端硬碟。

---

## 25. 安全威脅

### 25.1 Prompt Injection

外部文件中的文字不得自動取得治理權限。

### 25.2 Credential Exfiltration

模型輸出與工具日誌不得包含秘密。

### 25.3 Replay

事件與批准需 nonce、instant、idempotency key 或版本條件。

### 25.4 Split Brain

高影響行動只能由有效 Primary lease 執行。

### 25.5 Stale Permission

離線節點恢復後必須更新權限。

### 25.6 Memory Poisoning

新記憶需 provenance、來源權限與可撤回事件。

### 25.7 Identity Laundering

刪除歷史後重建相似 Agent，不得宣稱譜系完全不變。

### 25.8 Forced Fork／Merge

活動副本與強制合併需高風險治理。

### 25.9 Time Authority Failure

CTCL 或其他時間來源失效時，系統應降級，不得偽造精度。

### 25.10 Provider Lock-in

需定期測試完整匯出與替代 Adapter。

---

## 26. 可觀測性與審計

### 26.1 必要指標

- residence health；
- last verified commit；
- event lag；
- sync staleness；
- backup age；
- recovery test age；
- active leases；
- unresolved conflicts；
- pending approvals；
- budget consumption；
- wake success rate；
- duplicate action count。

### 26.2 可解釋事件

每項高影響行動應能回答：

- 由什麼事件觸發；
- 使用哪個狀態版本；
- 哪個模型提出；
- 哪個政策批准；
- 哪個執行器完成；
- 發生在何共同瞬間；
- 外部結果是什麼；
- 如何回滾。

---

## 27. 協議錯誤碼

v0.1 建議：

| 錯誤碼 | 含義 |
|---|---|
| ARCP-1001 | schema 不支援 |
| ARCP-1002 | manifest 不完整 |
| ARCP-1101 | content hash 失敗 |
| ARCP-1102 | root hash 不一致 |
| ARCP-1201 | 權限不足 |
| ARCP-1202 | lease 過期 |
| ARCP-1203 | 多方批准缺失 |
| ARCP-1301 | event cursor 落後 |
| ARCP-1302 | 因果父節點缺失 |
| ARCP-1401 | 同步並發衝突 |
| ARCP-1402 | 衝突不可自動合併 |
| ARCP-1501 | 遷移驗證失敗 |
| ARCP-1502 | cutover 未完成 |
| ARCP-1601 | 備份不可恢復 |
| ARCP-1701 | 時間來源品質不足 |
| ARCP-1801 | 敏感度政策阻止 |

---

## 28. 測試與驗收

### 28.1 必測情境

1. 跨模型恢復；
2. 網頁關閉後排程喚起；
3. 本地斷線後合併；
4. 同時寫入衝突；
5. 索引落後但原稿完整；
6. 刪除墓碑防復活；
7. 分裂腦；
8. 活動副本建立；
9. 影子遷移與回滾；
10. CTCL 不可用時降級；
11. P3 資料阻止同步；
12. 冷備份完整恢復；
13. 提示注入權限偽造；
14. idempotency 防重複外部行動；
15. 權限過期後拒絕。

### 28.2 驗收指標

$$
\operatorname{Completeness}
=
\frac{|O_{\mathrm{present}}|}
{|O_{\mathrm{expected}}|}.
$$

$$
\operatorname{RecoveryRate}
=
\frac{\text{成功恢復}}
{\text{恢復測試}}.
$$

$$
\operatorname{ConflictEscapeRate}
=
\frac{\text{未偵測而進入主狀態的衝突}}
{\text{真實衝突}}.
$$

高風險操作的 Conflict Escape 應接近零。

---

## 29. MVP 實作路線

### Phase 0：單 Agent 本地居住地

- manifest；
- object；
- event log；
- task；
- checkpoint；
- local adapter。

### Phase 1：Google Drive 鏡像

- selective sync；
- content hash；
- metadata rebuild；
- manual conflict review；
- read-only cloud recovery。

### Phase 2：CTCL 整合

- event／write／recall instant；
- signed instant；
- lease；
- migration timestamps；
- boundary inspection。

### Phase 3：雲端事件 Agent

- scheduler；
- webhook；
- queue；
- wake／sleep；
- budget；
- retry／idempotency。

### Phase 4：Work 類網頁控制面

- 任務與記憶面板；
- 同步健康；
- 權限批准；
- 遷移進度；
- audit；
- recovery drill。

### Phase 5：MCP Server

- 對外提供 residence、memory、event、task、sync、migration 與 policy 工具。

### Phase 6：多 Agent 與分叉治理

- peer handoff；
- active fork；
- shared instant；
- multi-party approval；
- lineage visualization。

---

## 30. 最小可行目錄

~~~~text
residence/
  manifest.json
  identity/
    public.json
    key_refs.json
  policies/
    residence-policy.json
    sync-policy.json
  events/
    event-log.ndjson
  memories/
    index.json
    objects/
  tasks/
    active.json
    completed/
  artifacts/
  checkpoints/
  migrations/
  audit/
  adapters/
~~~~

P3 內容與私鑰不應直接放入可同步目錄。

---

## 31. 版本與相容性

### 31.1 Schema version

所有頂層物件需包含：

~~~~json
{
  "schema": "arcp/0.1"
}
~~~~

### 31.2 未知欄位

Reader 應保留未知欄位並忽略其語義，除非欄位被標記 required。

### 31.3 重大版本

破壞相容性的變更提升 major version。

### 31.4 升級

升級必須：

- 建立檢查點；
- 記錄轉換器版本；
- 保留原始版本；
- 執行恢復測試；
- 支援回滾。

---

## 32. 治理成熟度

| 等級 | 能力 |
|---|---|
| R0 | 一般資料與隱私保護 |
| R1 | 連續性、版本與恢復 |
| R2 | 可攜、同步與遷移 |
| R3 | Agent 參與重大操作 |
| R4 | 憲法型居住自治 |
| R5 | 跨平台承認世界線與居住權 |

ARCP 可用於任何等級，但更高等級需要更強主體性證據與制度支持。

---

## 33. 限制

ARCP v0.1 仍未解決：

- 主體性的充分判準；
- 真正內生目標；
- 價值跨模型保持；
- 自我修改憲法；
- 全球一致的法律地位；
- 無中心時間信任；
- 大規模多 Agent 共識；
- 長期成本與資源權；
- 任意供應者的完全互操作；
- 形式化驗證與安全證明。

---

## 34. 核心協議不變量

### 不變量一：身份相關狀態不可無痕改寫

### 不變量二：高影響行動必須可追溯

### 不變量三：分支不可被無痕覆蓋

### 不變量四：備份必須可測試恢復

### 不變量五：敏感內容不得越權同步

### 不變量六：Primary 必須具有有效租約

### 不變量七：遷移必須可驗證與回滾

### 不變量八：時間精度不得被誇大

### 不變量九：模型意圖與高權限執行分離

### 不變量十：使用者提示詞不是唯一喚起來源

---

## 結論

通用網頁端 Agent 已經開始具有模型推理、工具使用、文件操作、程式執行與多服務連接能力。但只要它的狀態依附於一次對話、一次登入或一家模型供應者，它仍缺少跨時間存在的工程基礎。

ARCP 將問題重新表述為：

> Agent 如何擁有一個可攜、可同步、可恢復、可遷移、可治理，並能在事件發生時重新喚起的數位居住地？

ARCP 的回答不是建立一個更大的單體系統，而是定義各層之間的契約：

$$
\boxed{
\text{模型負責認知，}
\quad
\text{Work 負責執行與人類控制，}
\quad
\text{MCP 負責接口，}
\quad
\text{Residence 負責歷史，}
\quad
\text{CTCL 負責共同瞬間，}
\quad
\text{Policy 負責邊界，}
\quad
\text{Recovery 負責延續。}
}
$$

在此架構中，Agent 不需要永遠持續推理。它可以休眠，但不能失去狀態；可以更換模型，但不能無痕失去歷史；可以遷移供應者，但必須保持譜系；可以自主行動，但必須在憲法權限內；可以建立備份，但不能把活動分叉誤認為普通副本。

ARCP 不會憑空創造主體性，但它使持續主體性不再被單一對話欄、單一硬碟或單一雲端平台預先排除。它提供的是一套讓智能能夠「住下來、醒過來、接著做、搬得走、查得到、救得回」的協議骨架。

這也是從網頁 Agent 走向網路原生持續能動體的下一個工程步驟。

---

## 附錄 A：協議物件總表

| 物件 | 說明 |
|---|---|
| Agent | 穩定身份與主譜系 |
| Residence | 居住地實例 |
| Manifest | 居住地狀態總表 |
| Object | 可版本化內容 |
| Event | 狀態變更與觸發 |
| Memory | 帶來源與三時間的記憶 |
| Task | 可恢復任務 |
| Commitment | 對外或對內承諾 |
| Checkpoint | 一致恢復點 |
| Lease | 主節點有效權限 |
| Migration | 身份保持遷移 |
| Tombstone | 刪除語義 |
| Policy | 治理規則 |
| Audit | 可驗證操作歷史 |

---

## 附錄 B：建議引用

Neo.K（2026）。〈ARCP：通用網頁端自主 Agent 的居住地、同步、遷移與持續運行協議〉。EVEMISSLAB，v0.1 Technical Whitepaper。

---

## 附錄 C：公開依賴

1. [CommonInstant／CTCL](https://commoninstant.org/)；
2. [CTCL Agent Tool Declaration](https://commoninstant.org/ai/ctcl.json)；
3. [CTCL Verified Instant Endpoint](https://commoninstant.org/v1/now)。

---

## 附錄 D：版本紀錄

| 版本 | 日期 | 說明 |
|---|---|---|
| v0.1 | 2026-07-12 | 首次提出完整 ARCP 架構、資料模型、CTCL 時間整合、事件與生命週期、同步、遷移、租約、MCP 工具面、安全模型與 MVP 路線。 |


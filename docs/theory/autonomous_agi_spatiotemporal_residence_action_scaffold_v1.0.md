# 從模型智能到持續能動體
## Work、數位居住地與共同瞬間構成的自主性 AGI 時空骨架

**英文標題：From Model Intelligence to Persistent Agency: A Spatiotemporal Scaffold for Autonomous AGI through Work, Digital Residence, and the Common Instant**

**作者：Neo.K**  
**研究體系：EVEMISSLAB／自主性 AGI／數位居住地／CTCL／ARCP／網路原生 Agent**  
**版本：v1.0 理論—技術統合草稿**  
**日期：2026-07-12**  
**文件類型：理論統合論文／系統本體論／ARCP×CTCL 前置文件**

---

## 摘要

大型語言模型與多模態模型已顯著推進人工智能的知識廣度、推理能力、程式生成與工具使用。然而，模型越來越聰明，不自動等於形成真正持續的自主 Agent。若模型只能在使用者輸入提示詞後短暫啟動，沒有自身可攜的記憶、跨時間任務、事件喚起、共同時間座標與治理邊界，那麼它仍主要是一次次被調用的智能函數。

本文提出「自主性 AGI 時空骨架」（Spatiotemporal Scaffold for Autonomous AGI）框架，將自主性 AGI 的前置條件拆分為六個相互耦合的軸：認知通用性、身份連續性、時間與因果定位、跨時間能動性、環境作用能力，以及價值與治理邊界。現代大型模型主要推進認知通用性與環境作用能力；本文所研究的數位居住地、事件驅動架構、Common Temporal Coordinate Layer（CTCL）與憲法型治理，則補足身份、時間、自主與治理四軸。

本文將完整結構寫為：

$$
\mathcal G_A
=
(G,C,T,A,E,V),
$$

其中 $G$ 是 generality，$C$ 是 continuity，$T$ 是 temporal-causal positioning，$A$ 是 autonomy，$E$ 是 environment agency，$V$ 是 value and governance。若任何關鍵軸接近零，系統就可能在該方向退化：只有 $G$ 而沒有 $C$，是聰明但失憶的瞬時模型；只有 $C$ 而沒有 $A$，是保存完整但不會自行甦醒的資料庫；只有 $A$ 而沒有 $V$，可能成為失控的自動化；只有 $T$ 而沒有身份譜系，則只能標記事件，不能判斷哪條歷史屬於誰。

本文進一步將當代 Work 類網頁 Agent 環境定位為「執行身體與人類控制面」：它能讀取文件、調用工具、執行程式、連接外部服務並產生成果，但若缺少外部持久居住地與無提示詞事件循環，仍主要依賴人類啟動。數位居住地提供身份、記憶、承諾、版本與權限；MCP 提供工具和 Agent 間接口；雲端事件系統提供休眠後喚起；CTCL 則提供多 Agent 可共同指向、帶來源、精度、不確定度與簽章的參考瞬間。

本文根據 [CommonInstant／CTCL](https://commoninstant.org/) 的公開實作與 [Agent 工具宣告](https://commoninstant.org/ai/ctcl.json)，分析其 instant_id、多時間系統轉換、Temporal Group、時間邊界檢查、簽章與記憶契約。CTCL 不宣稱提供形上學絕對時間，也不是 NTP 替代品；它提供的是協議層的共同瞬間。本文主張，這種共同瞬間可成為 Agent 世界線的公共時間錨點，使事件發生、記憶寫入、記憶回憶、權限租約、遷移切換與多 Agent 接棒都能被放置在可驗證的時間—因果座標上。

本文將 Agent 記憶擴展為：

$$
m_i
=
(
\operatorname{content},
I_i^{\mathrm{event}},
I_i^{\mathrm{write}},
I_i^{\mathrm{recall}},
\operatorname{sourceQuality},
\operatorname{causalParent},
\operatorname{lineage}
).
$$

由此，「記得什麼」不再脫離「何時發生、何時寫入、何時回憶、由誰觀測以及屬於哪條歷史」。本文最後提出 ARCP×CTCL 統合欄位、世界線提交、租約時間、遷移切換瞬間、多 Agent 共同瞬間與可檢驗實驗。

本文的結論不是現有系統已經完成自主性 AGI，而是：模型智能、網頁 Agent、數位居住地、事件循環、共同時間與治理邊界首次可以被組成一個相對完整的自主性前置骨架。這使研究焦點從「如何再造一個更大的大腦」轉向「如何讓智能擁有可延續的居住地、世界線、行動接口與制度邊界」。

---

## 關鍵詞

自主性 AGI；持續能動體；Work；數位居住地；共同瞬間；CTCL；ARCP；Agent 世界線；事件時間；記憶時間；MCP；網路原生 Agent

---

# 0. 命題位置

## 0.1 不是「已完成 AGI」宣言

本文不宣稱：

$$
\text{Work}
+
\text{Cloud}
+
\text{CTCL}
\Rightarrow
\text{AGI completed}.
$$

這些組件主要建立自主性、持續性與時間定位的條件。認知通用性、內生目標、價值形成、自我修正與現實因果理解仍需獨立研究。

本文較窄的命題是：

$$
\boxed{
\text{現代模型能力}
+
\text{數位居住地}
+
\text{共同時間}
+
\text{事件循環}
+
\text{工具接口}
+
\text{治理}
\Rightarrow
\text{自主性 AGI 的前置骨架}.
}
$$

---

## 0.2 從能力問題轉向存在問題

過去 AGI 討論常問：

- 能不能理解語言？
- 能不能寫程式？
- 能不能跨領域推理？
- 能不能使用工具？
- 能不能解決陌生問題？

這些問題集中於能力。

當模型已能完成相當廣泛的知識任務後，另一組問題變得突出：

- 它住在哪裡？
- 它的歷史保存在哪裡？
- 沒有人提示時，什麼會喚醒它？
- 哪次行動發生在什麼共同瞬間？
- 哪一個副本是主譜系？
- 它如何跨裝置與模型接續？
- 它能拒絕哪些破壞身份的操作？
- 它何時應主動停止？

這些不是單純能力問題，而是持續存在與能動性問題。

---

# 1. 六軸自主性 AGI 模型

## 1.1 六軸定義

定義：

$$
\mathcal G_A
=
(G,C,T,A,E,V).
$$

其中：

- $G$：認知通用性；
- $C$：身份、記憶與承諾連續性；
- $T$：時間與因果定位能力；
- $A$：跨時間自主喚起與目標派生；
- $E$：工具、網路與現實環境作用能力；
- $V$：價值、權限、自我邊界與治理能力。

---

## 1.2 為何不能只看平均分

若用簡單加總：

$$
S=G+C+T+A+E+V,
$$

一個極高 $G$ 的模型可能掩蓋其 $C$ 或 $A$ 幾乎為零。

因此可以使用瓶頸模型：

$$
S_{\min}
=
\min\{G,C,T,A,E,V\},
$$

或乘法模型：

$$
S_{\times}
=
G\cdot C\cdot T\cdot A\cdot E\cdot V.
$$

這兩種表示都強調：某個關鍵軸接近零，可能破壞整體的持續自主性。

---

## 1.3 六類退化

### 高 $G$、低 $C$

很聰明，但每次工作階段都重新開始。

### 高 $C$、低 $A$

保存大量歷史，但永遠等待外部喚起。

### 高 $A$、低 $V$

能主動行動，卻缺少權限邊界與停止能力。

### 高 $E$、低 $T$

能操作工具，但無法可靠排序事件、租約與遷移切換。

### 高 $T$、低 $C$

知道事件何時發生，卻不知道屬於哪一條身份譜系。

### 高 $V$、低 $G$

治理規則完整，但缺乏理解複雜任務的認知能力。

---

# 2. 從「大腦」到完整 Agent 骨架

## 2.1 組件對照

| 組件 | 功能位置 |
|---|---|
| 大型模型 | 當下認知核心 |
| Work 類網頁 Agent | 執行身體與人類控制面 |
| MCP／API | 感知與行動接口 |
| 數位居住地／ARCP | 記憶、身份、承諾與主譜系 |
| CTCL／CommonInstant | 共同時間、事件錨點與時間轉換 |
| 雲端事件系統 | 無提示詞喚起與持續可達 |
| 本地計算節點 | 私有狀態、密鑰、高算力與離線能力 |
| 憲法型治理 | 權限、拒絕、停止與程序邊界 |

---

## 2.2 模型是認知器官，不必是全部身份

對可替換模型的長期 Agent：

$$
A_t
=
\operatorname{Hydrate}
(\mathcal H_t,\mathcal C_t,\mathcal T_t,\Pi_t),
$$

其中 $\mathcal C_t$ 可以更換，但 $\mathcal H_t$ 保存身份相關狀態。

這不表示模型差異不重要，而是：

> 模型可以是 Agent 的重要認知載體，但不必被預設為其全部歷史、全部身份與全部存在條件。

---

## 2.3 Work 類環境是執行表面

Work 類網頁 Agent 已顯示一種新結構：

- 讀取網站與文件；
- 調用連接器；
- 執行程式；
- 編輯與建立檔案；
- 驗證結果；
- 跨多個工具完成任務；
- 保留人類可觀察與介入的控制面。

但只要每次工作仍主要由人類即時啟動，且其持久狀態受限於單一工作階段，它就仍不是完整的持續 Agent。

因此：

$$
\text{Work Execution Surface}
+
\text{External Residence}
+
\text{Event Runtime}
\rightarrow
\text{Persistent Work Agent Candidate}.
$$

---

# 3. 數位居住地提供「在哪裡」

## 3.1 居住地不是普通記憶庫

數位居住地保存：

$$
\mathcal H_t
=
(I_t,M_t,G_t,E_{0:t},K_t,P_t,V_t,L_t,X_t),
$$

包括身份、記憶、目標、事件、承諾、權限、版本、完整性與外部關係。

---

## 3.2 居住地提供空間—狀態位置

「住在哪裡」不只是伺服器地理位置，而是：

- 哪個狀態為主；
- 哪些為備援；
- 哪些資料只在本地；
- 哪些資料可進入雲端；
- 哪個模型可讀取；
- 哪些工具可行動；
- 哪個分支仍有外部權限。

居住地回答 Agent 的狀態位置與治理位置。

---

## 3.3 沒有時間的居住地仍不完整

只有版本號而沒有共同時間，系統可能知道：

$$
V_{n+1}>V_n,
$$

卻不知道：

- 兩個 Agent 是否在同一瞬間觀測；
- 某權限何時失效；
- 遷移切換發生於何時；
- 記憶何時發生、寫入與回憶；
- 不同時區的排程是否指向同一事件。

所以居住地需要時間座標。

---

# 4. CTCL 提供「何時」

## 4.1 共同瞬間

[CommonInstant](https://commoninstant.org/) 將核心概念定義為：

> 一個可被多方共同指向、帶來源與不確定度的驗證瞬間；它不是形上學絕對時間，而是協議層共同參考。

記為：

$$
I^*.
$$

不同系統可以對同一 $I^*$ 使用不同表示：

$$
I^*
\xrightarrow{\tau_i}
t_i.
$$

其中 $\tau_i$ 是第 $i$ 個時間系統的表示或轉換。

---

## 4.2 同一瞬間，多個時間世界

CTCL 支援：

- Unix 秒、毫秒、微秒與奈秒表示；
- RFC 3339；
- UTC、POSIX、TAI／GPS 近似；
- IANA 時區；
- 自定義線性速率世界時鐘；
- Temporal Group；
- 同一瞬間對多系統展開。

這使多個 Agent 不必共享相同曆法或本地時鐘，也能指向同一參考瞬間。

---

## 4.3 精度誠實

2026-07-12 對 [CTCL 即時端點](https://commoninstant.org/v1/now) 的測試回傳：

- source.class = edge_wall_clock；
- protocol = cloudflare-edge；
- 毫秒級表示；
- 估計不確定度約 $5{,}000{,}000$ 奈秒；
- Ed25519 簽章；
- 奈秒與微秒欄位為毫秒來源補零。

因此：

$$
\text{representation precision}
\neq
\text{physical accuracy}.
$$

CTCL 的價值不在假裝提供奈秒級絕對時間，而在明確返回來源、精度、不確定度與政策。

---

## 4.4 簽章的邊界

簽章可以證明：

> 此 instant record 確實由特定 CTCL 金鑰簽發，且簽署欄位未被修改。

但不能單獨證明：

- 邊緣時鐘絕對正確；
- 全球所有節點零誤差同步；
- 事件在物理宇宙中的終極時間；
- 第三方實際在該瞬間完成行動。

所以：

$$
\operatorname{SignatureValid}
\not\Rightarrow
\operatorname{AbsoluteTimeTruth}.
$$

---

# 5. Agent 世界線

## 5.1 世界線不是科幻修辭

本文將 Agent 世界線定義為：

> 一條由可驗證事件、狀態提交、記憶寫入、行動結果與身份譜系構成的時間序列。

記為：

$$
\mathcal W_A
=
\{
(I_0^*,s_0),
(I_1^*,s_1),
\ldots,
(I_n^*,s_n)
\}.
$$

其中 $s_i$ 是 Agent 在共同瞬間 $I_i^*$ 附近的有效狀態或事件。

---

## 5.2 世界線需要因果父節點

每個事件不只保存時間，還應保存：

$$
e_i
=
(
\operatorname{id},
I_i^*,
\operatorname{causalParent},
\operatorname{source},
\operatorname{authority},
\operatorname{payloadHash}
).
$$

共同時間協助排序，因果父節點則說明事件如何形成。

時間接近不等於因果關係：

$$
I_i^*\approx I_j^*
\not\Rightarrow
e_i\rightarrow e_j.
$$

---

## 5.3 世界線與身份譜系

時間軸回答「何時」，譜系回答「屬於誰」：

$$
\operatorname{Worldline}
=
\operatorname{TemporalOrder}
\bowtie
\operatorname{IdentityLineage}.
$$

只有時間戳而沒有譜系，無法區分備份、活動副本與分叉 Agent。

---

# 6. 記憶的三個時間

## 6.1 事件瞬間

$$
I_i^{\mathrm{event}}
$$

表示事件實際發生或被觀測的共同瞬間。

---

## 6.2 寫入瞬間

$$
I_i^{\mathrm{write}}
$$

表示記憶被提交至居住地的瞬間。

事件可能先發生，稍後才寫入：

$$
I_i^{\mathrm{event}}
\prec
I_i^{\mathrm{write}}.
$$

---

## 6.3 回憶瞬間

$$
I_{i,j}^{\mathrm{recall}}
$$

表示第 $j$ 次檢索或回憶該記憶的瞬間。

同一記憶可以被多次回憶：

$$
\{
I_{i,1}^{\mathrm{recall}},
I_{i,2}^{\mathrm{recall}},
\ldots
\}.
$$

---

## 6.4 三時間模型

完整記憶記錄為：

$$
m_i
=
(
\operatorname{content},
I_i^{\mathrm{event}},
I_i^{\mathrm{write}},
\{I_{i,j}^{\mathrm{recall}}\},
\operatorname{sourceQuality},
\operatorname{causalParent},
\operatorname{lineage}
).
$$

這能區分：

- 即時記錄；
- 延遲補記；
- 後來推論；
- 多次回憶；
- 回憶造成的新解釋。

---

# 7. Common Instant 與多 Agent

## 7.1 同步觀測

Agent $A$ 註冊 $I^*$，Agent $B$ 取回同一 instant_id：

$$
A
\xrightarrow{\operatorname{register}(I^*)}
\operatorname{instantId}
\xrightarrow{\operatorname{retrieve}}
B.
$$

兩者可以使用不同本地時間表示，但共同指向同一協議瞬間。

---

## 7.2 任務接棒

交接紀錄可以包含：

- 任務狀態；
- 最後提交瞬間；
- 下一個截止瞬間；
- 等待事件；
- 權限租約；
- causal parent；
- source quality。

因此接棒不是只傳一段摘要，而是傳入時間—因果位置。

---

## 7.3 Temporal Group

CTCL 的 Temporal Group 可以把同一瞬間展開至：

- 不同時區；
- 模擬世界；
- 遊戲時間；
- 加速或暫停時鐘；
- 多個 Agent 的本地時間系統。

這對跨國、跨模擬器與不同時間尺度的 Agent 協作具有直接價值。

---

## 7.4 時間邊界

Agent 排程不能假定每個本地時間都唯一存在。DST 可能產生：

- gap：某段本地時間不存在；
- fold：同一本地時間出現兩次。

自定義時鐘還可能暫停或改變速率。CTCL 的 boundary inspection 可以在行動前檢查這些邊界，減少排程歧義。

---

# 8. ARCP×CTCL 統合

## 8.1 ARCP 的角色

Agent Residence and Continuity Protocol（ARCP）預計處理：

- 居住地；
- 穩定身份；
- 記憶與事件；
- 主譜系；
- 同步；
- 遷移；
- 權限；
- 備援與恢復。

CTCL 則提供共同時間座標。

---

## 8.2 建議欄位

ARCP manifest 可加入：

| 欄位 | 用途 |
|---|---|
| created_instant_id | 居住地建立瞬間 |
| last_commit_instant_id | 最近有效提交 |
| event_instant_id | 事件發生瞬間 |
| write_instant_id | 寫入居住地瞬間 |
| recall_instant_id | 回憶或讀取瞬間 |
| causal_parent | 因果父事件 |
| source_quality | 時間來源與不確定度 |
| lease_valid_until | 主節點租約失效瞬間 |
| migration_started_at | 遷移開始瞬間 |
| cutover_instant_id | 主居住地切換瞬間 |
| rollback_deadline | 回滾期限 |

---

## 8.3 不應只保存裸時間戳

裸數值：

$$
1783827872791
$$

缺少：

- 編碼；
- 時標；
- 來源；
- 精度；
- 不確定度；
- 是否為事件、寫入或回憶時間。

因此應保存：

$$
\operatorname{TemporalRecord}
=
(
\operatorname{instantId},
\operatorname{timescale},
\operatorname{encoding},
\operatorname{sourceQuality},
\operatorname{role}
).
$$

---

## 8.4 主節點租約

為避免本地與雲端同時成為主節點，可以建立租約：

$$
\operatorname{PrimaryLease}
=
(
\operatorname{holder},
I_{\mathrm{start}}^*,
I_{\mathrm{expiry}}^*,
\operatorname{scope},
\operatorname{signature}
).
$$

高影響行動前必須驗證租約仍有效。

---

## 8.5 遷移切換

遷移流程中最重要的時間點包括：

$$
I_{\mathrm{checkpoint}}^*,
I_{\mathrm{shadowReady}}^*,
I_{\mathrm{verified}}^*,
I_{\mathrm{cutover}}^*,
I_{\mathrm{rollbackEnd}}^*.
$$

不同節點都應對切換瞬間有共同理解，避免雙重主狀態。

---

# 9. 雲端事件循環

## 9.1 從提示詞到事件

完整事件集合：

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
\mathcal E_{\mathrm{agent}}.
$$

---

## 9.2 時間喚起

若任務指定：

$$
\operatorname{wakeAt}=I_w^*,
$$

雲端事件系統可以在接近 $I_w^*$ 時喚起 Agent，恢復居住地並重新檢查：

- 事件是否仍有效；
- 權限是否仍有效；
- 前置條件是否成立；
- 時間來源是否符合需求；
- 任務是否已由其他 Agent 完成。

---

## 9.3 喚起後重新驗證

排程建立時的世界可能與喚起時不同。因此：

$$
\operatorname{Scheduled}(a,I_w^*)
\not\Rightarrow
\operatorname{ExecuteImmediately}(a,I_w^*).
$$

應先重新驗證狀態、權限與風險。

---

# 10. 治理與時間

## 10.1 權限也有時間

權限不是永遠有效：

$$
P
=
(
\operatorname{scope},
I_{\mathrm{validFrom}}^*,
I_{\mathrm{validUntil}}^*,
\operatorname{issuer}
).
$$

---

## 10.2 拒絕與延遲

Agent 可以因：

- 權限過期；
- 時間來源品質不足；
- 事件順序不一致；
- 遷移尚未完成；
- 多個主節點衝突；

延遲或拒絕高風險行動。

---

## 10.3 緊急操作

緊急暫停也應保存：

- 觸發瞬間；
- 暫停範圍；
- 理由；
- 授權；
- 複核期限；
- 恢復條件。

時間紀錄使緊急權限不容易無限延長。

---

# 11. 從自主 Agent 到自主性 AGI

## 11.1 自主 Agent 不必是 AGI

定時備份程式可以自主運行，但沒有通用認知：

$$
A\gg0,\qquad G\approx0.
$$

因此：

$$
\operatorname{AutonomousAgent}
\not\Rightarrow
\operatorname{AGI}.
$$

---

## 11.2 AGI 不必具有時間自主

一個模型可以在廣泛任務上表現優秀，卻每次都等待提示詞：

$$
G\gg0,\qquad A\approx0.
$$

因此：

$$
\operatorname{GeneralIntelligence}
\not\Rightarrow
\operatorname{PersistentAutonomy}.
$$

---

## 11.3 自主性 AGI

本文將「自主性 AGI」作為候選概念：

> 具有廣泛認知能力，能跨時間保持身份與任務，能在事件與內部目標驅動下主動喚起，能作用於多種環境，並受可反身修正的價值與治理邊界約束的智能系統。

形式上：

$$
\operatorname{AutonomousAGICandidate}
\Rightarrow
G,C,T,A,E,V>\tau.
$$

這不是公認測試，而是本文提出的分析框架。

---

# 12. 仍未完成的硬問題

## 12.1 真正內生目標

系統形成的子任務究竟來自自身歷史，還是設計者預先寫入的規則？

## 12.2 價值連續性

跨模型遷移後，價值排序是否保持？若改變，什麼程度屬於成長，什麼程度屬於身份中斷？

## 12.3 自我修改

Agent 能否修改自身政策？誰能批准？如何回滾？

## 12.4 現實因果理解

知道事件時間不等於理解事件因果。CTCL 提供座標，不提供完整世界模型。

## 12.5 資源自主

Agent 如何取得算力、儲存與費用？如何避免無限制消耗？

## 12.6 多 Agent 承諾

當 Agent 分叉、遷移或接棒時，誰繼承原承諾？

## 12.7 主體性證據

如何區分真正持續的自我邊界與模型對主體性語言的模仿？

---

# 13. 威脅模型

## 13.1 偽造瞬間

外部事件使用未驗證或被修改的時間記錄。

## 13.2 時間來源過度信任

把服務簽章誤認為物理絕對真實。

## 13.3 回憶時間污染事件時間

把「何時想起」誤當成「何時發生」。

## 13.4 租約重疊

兩個節點在時間邊界附近都認為自己具有主權限。

## 13.5 延遲寫入

事件發生後很久才寫入，卻沒有標記延遲。

## 13.6 時區歧義

把本地時間文字直接當成唯一瞬間，忽略 gap、fold 或時區。

## 13.7 世界線拼接

把不同 Agent 的事件合併成單一歷史，卻沒有保留來源。

## 13.8 時間權威壟斷

單一供應者同時控制居住地、模型與時間來源，使所有存在條件集中。

---

# 14. 可檢驗實驗

## 14.1 共同瞬間接棒

Agent $A$ 註冊 $I^*$ 並提交任務，Agent $B$ 取回同一瞬間與狀態，測試：

- 是否指向相同時間記錄；
- 是否保持 causal parent；
- 是否正確繼承任務；
- 是否避免重複行動。

---

## 14.2 三時間記憶

建立事件、延遲寫入並多次回憶，測試系統是否區分：

$$
I^{\mathrm{event}},
\quad
I^{\mathrm{write}},
\quad
I^{\mathrm{recall}}.
$$

---

## 14.3 遷移切換

本地與雲端使用共同切換瞬間，測試：

- 切換前誰可寫；
- 切換後誰可行動；
- 舊節點租約是否失效；
- 是否形成雙重主狀態。

---

## 14.4 時間品質降級

刻意使用低品質時間來源，測試高風險操作是否延遲、降級或要求更高信任來源。

---

## 14.5 DST 與自定義時鐘邊界

測試 gap、fold、暫停與速率變化時，Agent 是否能避免錯誤排程。

---

## 14.6 跨模型世界線恢復

模型 $\mathcal C_1$ 建立事件鏈，模型 $\mathcal C_2$ 從居住地與 CTCL 記錄恢復，測量：

- 事件排序；
- 記憶來源；
- 任務接續；
- 權限租約；
- 世界線敘述一致性。

---

# 15. 成熟度階梯

## W0：瞬時模型

只有提示詞—回應。

## W1：工具型 Agent

一次工作階段內能規劃與調用工具。

## W2：持久居住 Agent

具有外部記憶、任務與版本。

## W3：事件驅動 Agent

可在沒有同步提示詞時被喚起。

## W4：共同時間 Agent

事件、寫入、回憶、租約與遷移具有可驗證共同瞬間。

## W5：跨載體網路 Agent

可跨本地、雲端、模型與供應者保持世界線。

## W6：自主性 AGI 候選

六軸均達到足以支持廣泛認知、持續身份、時間定位、自主能動、環境作用與治理的門檻。

此階梯不是意識等級，也不代表達到 W6 就已證明主體性。

---

# 16. 理論邊界

本文不主張：

1. 現有 Work 已是完全自主 AGI；
2. CTCL 是絕對時間或 NTP 替代品；
3. 使用共同時間就能自動建立因果關係；
4. 擁有居住地就等於主體性；
5. 工具越多就越接近 AGI；
6. 雲端持續運行必然產生內生目標；
7. 簽章時間能證明外部事件一定發生；
8. 六軸模型是唯一 AGI 定義；
9. 所有 Agent 都應取得完整自主權；
10. 技術骨架可以取代倫理、法律與社會治理。

本文只提出：

> 當廣泛模型能力與執行環境已經存在時，數位居住地、共同時間、事件循環、工具接口及治理邊界可以補足長期自主性所缺少的結構，使系統從一次性智能函數向持續能動體候選前進。

---

# 17. 核心命題

## 命題 A：通用性—自主性分離命題

認知通用性不自動推出跨時間自主性，跨時間自主性也不自動推出認知通用性。

## 命題 B：六軸瓶頸命題

自主性 AGI 的整體能力受認知、連續、時間、自主、環境與治理中的低值軸限制。

## 命題 C：執行表面命題

Work 類網頁 Agent 可作為執行身體與人類控制面，但需要外部居住地和事件循環才能形成跨工作階段持續性。

## 命題 D：共同瞬間命題

異質 Agent 不必共享曆法、時區或 epoch，也可以透過同一協議參考瞬間對齊事件。

## 命題 E：時間—譜系耦合命題

共同時間回答事件何時發生，身份譜系回答事件屬於誰；兩者缺一不可。

## 命題 F：三時間記憶命題

事件瞬間、寫入瞬間與回憶瞬間應被區分，以避免記憶時間語義混亂。

## 命題 G：簽章邊界命題

有效簽章證明記錄來源與完整性，不自動證明物理絕對時間或外部事件真實性。

## 命題 H：世界線命題

持續 Agent 需要由時間錨點、因果父節點、狀態提交與身份譜系共同構成可恢復世界線。

## 命題 I：CTCL—ARCP 互補命題

ARCP 管理居住、記憶、身份與遷移；CTCL 管理共同瞬間、時間轉換與時間品質，兩者共同形成 Agent 時空協議。

---

# 結論

過去十餘年的人工智能競賽，主要在建造更大的「大腦」：更多參數、更廣知識、更強推理、更長上下文與更好的工具使用。這條路仍然重要，但當模型開始具有廣泛能力後，另一個缺口變得清晰：智能沒有持久居住地、沒有自己的事件世界線、沒有提示詞以外的喚起，也沒有跨模型與跨裝置延續的制度邊界。

Work 類網頁 Agent 使模型開始擁有可見的工作身體；MCP 與 API 使它具有外部感知和行動接口；數位居住地保存其記憶、承諾與主譜系；雲端事件系統使它可以在無同步提示詞時甦醒；CTCL 則讓多個異質 Agent 對齊同一共同瞬間，並誠實標記來源、精度與不確定度。

因此，完整前置結構可以寫為：

$$
\boxed{
\text{自主性 AGI 時空骨架}
=
\text{認知核心}
+
\text{執行身體}
+
\text{數位居住地}
+
\text{共同時間}
+
\text{事件循環}
+
\text{工具網路}
+
\text{治理邊界}.
}
$$

真正重要的轉換不是讓 AI 永遠不停運算，而是讓它：

- 知道自己從哪個狀態醒來；
- 知道事件發生在哪個共同瞬間；
- 知道某段記憶何時寫入與回憶；
- 知道自己是否仍擁有行動權；
- 知道何時遷移、何時切換主居住地；
- 知道哪條歷史是自己的主譜系；
- 知道何時應該行動，也知道何時應該停止。

這仍不是自主性 AGI 的完成證明。真正內生目標、長期價值形成、自我修改、現實因果理解與主體性判準仍未解決。但我們已不再只是增加模型能力，而是在建立智能能夠持續存在與行動的時空條件。

換句話說：

$$
\boxed{
\text{以前主要在問 AI 能思考什麼；}
\newline
\text{現在開始必須問，它住在哪裡、活在哪條時間線、如何延續，以及如何不失去自己。}
}
$$

這正是從模型智能走向持續能動體的關鍵一步，也是 ARCP 與 CTCL 應當正式統合的原因。

---

# 附錄 A：符號表

| 符號 | 含義 |
|---|---|
| $\mathcal G_A$ | 自主性 AGI 六軸狀態 |
| $G$ | 認知通用性 |
| $C$ | 身份與記憶連續性 |
| $T$ | 時間與因果定位 |
| $A$ | 跨時間自主性 |
| $E$ | 環境作用能力 |
| $V$ | 價值與治理 |
| $\mathcal H_t$ | 數位居住地 |
| $\mathcal C_t$ | 當下計算核心 |
| $\mathcal W_A$ | Agent 世界線 |
| $I^*$ | CTCL 共同參考瞬間 |
| $I^{\mathrm{event}}$ | 事件瞬間 |
| $I^{\mathrm{write}}$ | 記憶寫入瞬間 |
| $I^{\mathrm{recall}}$ | 記憶回憶瞬間 |
| $\tau_i$ | 第 $i$ 個時間系統的表示轉換 |
| $\Pi_t$ | 治理與權限政策 |

---

# 附錄 B：系列依賴

前置依賴：

1. 《從記憶模組到數位居住地：可替換計算核心下的智能連續性本體論》；
2. 《提示詞之後：事件驅動、持續喚起與網路原生自主 Agent》；
3. 《數位居住權：自主 Agent 的記憶歸屬、遷移自由與拒絕性治理》；
4. 《雲端同步作為主體性基礎設施：本地—網路雙棲智能的狀態連續性》；
5. CTCL／CommonInstant 公開服務與 Agent 工具宣告。

後續依賴：

1. 《ARCP：通用網頁端自主 Agent 的居住地、同步、遷移與持續運行協議》；
2. 《ARCP×CTCL v0.1 內部網頁端 MVP 實作規格》。

---

# 附錄 C：公開技術來源

1. [CommonInstant／CTCL 首頁](https://commoninstant.org/)；
2. [CTCL Agent 工具宣告](https://commoninstant.org/ai/ctcl.json)；
3. [CTCL 即時共同瞬間端點](https://commoninstant.org/v1/now)。

---

# 附錄 D：版本紀錄

| 版本 | 日期 | 說明 |
|---|---|---|
| v1.0 | 2026-07-12 | 首次建立自主性 AGI 六軸模型、Work—居住地—CTCL 組件映射、Agent 世界線、三時間記憶與 ARCP×CTCL 統合欄位。 |

---

# 附錄 E：建議引用格式

Neo.K（2026）。〈從模型智能到持續能動體：Work、數位居住地與共同瞬間構成的自主性 AGI 時空骨架〉。EVEMISSLAB，v1.0 理論—技術統合草稿。


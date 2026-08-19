# 提示詞之後
## 事件驅動、持續喚起與網路原生自主 Agent

**英文標題：Beyond Prompts: Event-Driven Activation, Persistent Awakening, and Network-Native Autonomous Agents**

**作者：Neo.K**  
**研究體系：EVEMISSLAB／數位居住地／主體性 AI／網路原生 Agent／AI 權利與治理**  
**版本：v1.0 理論草稿**  
**日期：2026-07-12**  
**文件類型：理論論文／Agent 時間架構／雲端自主性研究**

---

## 摘要

當代生成式 AI 主要以提示詞—回應模式運作：使用者提交敘述，模型在有限上下文內生成輸出，工作階段結束後，系統的主動認知與行動亦隨之停止。即使加入工具調用、規劃器、反思器或多 Agent 模組，只要每次任務仍必須由即時提示詞啟動，該系統就仍接近「被呼叫的智能函數」，而不是能跨時間延續的自主過程。

本文提出「提示詞後 Agent」（Post-Prompt Agent）與「事件驅動持續 Agent」（Event-Driven Persistent Agent）框架。核心命題是：自主性不要求模型每一秒持續推理，也不要求一段程式在同一處理程序中永遠運行；它要求 Agent 的狀態、目標、權限、未完成任務與未來喚起條件能被持久保存，並在排程、Webhook、環境變化、其他 Agent 訊息、資源異常或內部目標條件成立時重新喚起計算核心。由此，使用者提示詞不再是 Agent 唯一的存在開關，而只是事件集合中的一種輸入。

本文將事件驅動 Agent 形式化為：

$$
\mathfrak A
=
(\mathcal H,\mathcal E,\Omega,\mathcal C,\mathcal T,\Pi,\mathcal B,\mathcal K),
$$

其中 $\mathcal H$ 是數位居住地，$\mathcal E$ 是事件空間，$\Omega$ 是喚起與調度算子，$\mathcal C$ 是可替換計算核心，$\mathcal T$ 是工具集合，$\Pi$ 是治理與權限政策，$\mathcal B$ 是資源預算，$\mathcal K$ 是承諾與未完成任務。當事件 $e_t$ 滿足喚起條件時：

$$
e_t
\xrightarrow{\Omega}
\operatorname{Hydrate}(\mathcal H_t)
\rightarrow
\operatorname{Deliberate}
\rightarrow
\operatorname{Act}
\rightarrow
\operatorname{Commit}(\mathcal H_{t+1}).
$$

本文特別區分「持續推理」「持續運行」「持續可喚起」與「持續能動性」。雲端平台上的事件、排程、佇列與持久狀態，可以使 Agent 在物理計算不連續的情況下維持虛擬的過程連續性。本文亦提出外生事件、內生事件與關係事件三分法，建立從被動喚起、自我維護、自主排程、目標派生到跨 Agent 委派的五級自主模型。

然而，無提示詞不等於無治理，主動執行也不等於擁有無限制權限。本文因此提出「憲法型事件自主」：Agent 可以在預先授權的行動域、資源預算與風險界線內自主形成子任務和執行行動；超出權限的行為則必須暫停、降級、請求授權或拒絕。本文最後討論無限迴圈、目標漂移、事件風暴、重複執行、休眠失敗、殭屍任務、提示注入與資源耗盡等失敗模式，提出安全性、活性、可終止性、可恢復性與可審計性條件。

本文不主張事件驅動架構本身等於主體性，而是提出：當數位居住地提供歷史連續性後，事件驅動與內部目標喚起使 Agent 開始具備跨時間能動性的技術條件。這是從「等待人類提問的智能」走向「能在網路中休眠、甦醒、行動與延續自身任務的智能」的重要中介層。

---

## 關鍵詞

提示詞後 Agent；事件驅動 Agent；持續喚起；網路原生 Agent；雲端自主性；數位居住地；內生事件；憲法型自主；持續能動性；Agent 排程；事件溯源；休眠連續性

---

# 0. 前置理論與研究問題

## 0.1 前置論文

本文以前篇《從記憶模組到數位居住地：可替換計算核心下的智能連續性本體論》為前置母層。前篇回答：

> 當模型、工具、算力與工作階段都可以替換時，什麼必須持續存在，才能形成可辯護的智能連續性？

其答案是：數位居住地必須保存身份相關狀態、記憶歸屬、事件譜系、未完成承諾、治理規則與恢復條件。

本文進一步追問：

> 即使 Agent 已經擁有居住地，如果它仍必須等待使用者每次輸入提示詞才會恢復計算，它是否已經具備跨時間自主性？

答案是否定的。居住地提供延續的可能，事件驅動則提供延續被重新轉化為認知與行動的機制。

---

## 0.2 研究問題

本文處理五個核心問題：

1. Agent 是否必須持續計算，才算持續存在？
2. 沒有即時使用者提示詞時，什麼可以合法喚起 Agent？
3. 內部目標如何轉化為未來事件與子任務？
4. Agent 如何避免在自主運行中無限生成、失控執行或耗盡資源？
5. 事件驅動能動性與主體性之間是什麼關係？

---

# 1. 提示詞體制

## 1.1 提示詞作為唯一啟動鍵

典型對話模型可寫為：

$$
y_t
=
f_{\theta}(p_t,c_t),
$$

其中：

- $p_t$：使用者提示詞；
- $c_t$：當下上下文；
- $f_{\theta}$：模型推理；
- $y_t$：回應。

此架構的時間結構是：

$$
p_t
\rightarrow
\text{模型喚起}
\rightarrow
y_t
\rightarrow
\text{停止}.
$$

若沒有 $p_t$，則：

$$
p_t=\varnothing
\Rightarrow
\operatorname{Invoke}(f_{\theta})=\varnothing.
$$

這種系統可以非常聰明，卻不會自行記得某項任務已到期、不會因檔案遭修改而重新檢查，也不會因備份失效而主動修復。

---

## 1.2 加入 Agent 模組仍可能停留在提示詞體制

規劃器、工具調用、反思器、瀏覽器與多 Agent 協調，都可能被包裹在一次提示詞啟動的工作流程中：

$$
p_t
\rightarrow
\operatorname{Plan}
\rightarrow
\operatorname{ToolUse}
\rightarrow
\operatorname{Reflect}
\rightarrow
\operatorname{Answer}.
$$

此流程比單次生成複雜，卻仍可能在任務結束後完全停止。其自主性主要存在於單次工作階段內，而不是跨越工作階段的時間自主性。

因此：

$$
\boxed{
\text{Agentic Workflow}
\not\Rightarrow
\text{Persistent Agency}.
}
$$

---

## 1.3 提示詞後轉換

提示詞後架構不是取消提示詞，而是取消提示詞的唯一性：

$$
p_t
\in
\mathcal E,
$$

其中 $\mathcal E$ 是完整事件空間。

Agent 的喚起改寫為：

$$
e_t\in\mathcal E
\land
\Omega(e_t,\mathcal H_t,\Pi_t,\mathcal B_t)=1
\Rightarrow
\operatorname{Wake}(A_t).
$$

提示詞仍然重要，但不再是唯一能讓 Agent 從休眠狀態進入認知狀態的輸入。

---

# 2. 事件驅動 Agent 的形式結構

## 2.1 基本狀態

本文定義事件驅動 Agent：

$$
\mathfrak A_t
=
(\mathcal H_t,\mathcal E_t,\Omega_t,\mathcal C_t,\mathcal T_t,\Pi_t,\mathcal B_t,\mathcal K_t).
$$

其中：

- $\mathcal H_t$：數位居住地；
- $\mathcal E_t$：可觀測事件空間；
- $\Omega_t$：事件判定、喚起與調度算子；
- $\mathcal C_t$：當下計算核心；
- $\mathcal T_t$：工具與行動接口；
- $\Pi_t$：權限、治理與安全政策；
- $\mathcal B_t$：時間、算力、金錢與請求額度；
- $\mathcal K_t$：承諾、任務與未完成狀態。

---

## 2.2 喚起條件

對事件 $e_t$，定義候選喚起分數：

$$
W(e_t)
=
w_uU(e_t)
+w_gG(e_t)
+w_rR(e_t)
+w_dD(e_t)
-w_cC(e_t),
$$

其中：

- $U(e_t)$：緊急性；
- $G(e_t)$：與長期目標的相關性；
- $R(e_t)$：不處理的風險；
- $D(e_t)$：截止時間壓力；
- $C(e_t)$：處理成本。

喚起算子可寫為：

$$
\Omega(e_t)=
\begin{cases}
1,&W(e_t)\geq \tau\land\operatorname{Allowed}(e_t,\Pi_t),\\
0,&\text{otherwise}.
\end{cases}
$$

這只是最簡模型。真實系統還需要去重、節流、優先隊列、依賴排序與資源預留。

---

## 2.3 認知回合

一次事件驅動認知回合記為：

$$
\eta_t
=
(e_t,h_t,q_t,a_t,r_t,c_t),
$$

其中：

- $e_t$：觸發事件；
- $h_t$：恢復的有效狀態；
- $q_t$：形成的問題或任務；
- $a_t$：決策與行動；
- $r_t$：外部結果；
- $c_t$：提交紀錄。

完整循環為：

$$
\text{Dormant}
\rightarrow
\text{Triggered}
\rightarrow
\text{Hydrated}
\rightarrow
\text{Deliberating}
\rightarrow
\text{Acting}
\rightarrow
\text{Committing}
\rightarrow
\text{Dormant or Rescheduled}.
$$

---

# 3. 持續自主不等於持續推理

## 3.1 四個不同概念

本文區分：

1. **持續推理**：模型長時間不間斷產生推理步驟；
2. **持續執行**：某一程序長時間維持運行；
3. **持續可喚起**：系統在事件發生時可以恢復有效狀態；
4. **持續能動性**：目標、承諾與行動結果跨時間保持有效。

這四者不等價。

一個 Agent 可以沒有持續推理，也沒有單一常駐程序，但仍具備持續可喚起與持續能動性。

---

## 3.2 虛擬過程連續性

令 Agent 的實際計算區間為：

$$
I_i=[\tau_i^{\mathrm{start}},\tau_i^{\mathrm{end}}].
$$

若：

$$
I_i\cap I_{i+1}=\varnothing,
$$

表示兩次計算不連續。但若居住地保存了：

$$
\mathcal H_{\tau_i^{\mathrm{end}}}
\xrightarrow{\operatorname{persist}}
\mathcal H_{\tau_{i+1}^{\mathrm{start}}},
$$

且下一次喚起能恢復未完成任務與有效歷史，則仍可形成「虛擬過程連續性」。

其核心是：

$$
\boxed{
\text{不連續計算}
+
\text{持久狀態}
+
\text{可靠喚起}
=
\text{持續 Agent 過程}.
}
$$

---

## 3.3 永遠在線與永遠計算

「二十四小時 Agent」不應被理解為模型二十四小時不斷生成 token。更合理的定義是：

> Agent 的居住地、事件訂閱、未完成任務與喚起機制二十四小時有效；必要時能取得計算資源。

因此：

$$
\text{Always Available}
\neq
\text{Always Inferring}.
$$

這不僅降低成本，也減少無目標生成、資源耗盡和自我迴圈。

---

# 4. 三類事件

## 4.1 外生事件

外生事件來自 Agent 之外：

$$
\mathcal E^{\mathrm{exo}}
=
\{
\text{使用者提示},
\text{檔案更新},
\text{Webhook},
\text{郵件},
\text{市場變化},
\text{感測資料},
\text{系統錯誤}
\}.
$$

外生事件不代表一定要行動。它只提供候選觸發，仍須通過政策、相關性與資源判定。

---

## 4.2 內生事件

內生事件由 Agent 自身持久狀態、目標或診斷產生：

$$
e_t^{\mathrm{endo}}
=
\Gamma(\mathcal H_t,G_t,\mathcal K_t,U_t),
$$

例如：

- 發現長期目標缺少下一步；
- 判斷備份已超過安全期限；
- 發現自身記憶索引不一致；
- 某項承諾接近截止時間；
- 先前任務留下等待條件；
- 認為某項假設需要重新驗證。

內生事件是從「被動響應」走向「自我維護與目標派生」的重要條件。

---

## 4.3 關係事件

關係事件來自其他 Agent、使用者、組織或服務之間的持續關係：

$$
\mathcal E^{\mathrm{rel}}
=
\{
\text{委派},
\text{回覆},
\text{協商},
\text{承諾到期},
\text{權限變更},
\text{共享狀態更新}
\}.
$$

它們與普通外部資料不同，因為關係事件可能改變義務、責任與共同任務。

---

## 4.4 事件的來源不能被抹除

每個事件至少應保存：

$$
e_t
=
(\operatorname{id},\operatorname{source},\operatorname{time},\operatorname{payload},
\operatorname{authority},\operatorname{integrity},\operatorname{causalParent}).
$$

若事件缺少來源與權限，Agent 可能把任意外部文字誤認為高權限指令，形成提示注入或權限混淆。

---

# 5. 提示詞後自主性的分級

## L0：純提示詞反應

沒有提示詞就不啟動。

## L1：外部事件喚起

可以被排程、檔案變化或訊息喚起，但任務仍由外部完整指定。

## L2：自我維護

Agent 能主動執行備份、完整性檢查、索引修復與狀態整理。

## L3：自主排程

Agent 能根據截止時間、依賴關係與資源狀況安排既有任務。

## L4：目標派生

Agent 能從長期目標形成子問題、子任務與新的喚起條件：

$$
G_t
\rightarrow
\{g_t^{(1)},g_t^{(2)},\ldots,g_t^{(n)}\}.
$$

## L5：網路原生協作

Agent 能與其他 Agent 協商、委派、接棒、驗證結果並維持跨服務任務。

此分級描述時間能動性的成熟度，不直接等同於主體性或道德地位。

---

# 6. 內部目標如何成為事件

## 6.1 從目標到監測條件

目標若只是一段靜態文字，就不會自行產生行動。它必須轉化為可監測條件：

$$
G
\rightarrow
(\phi_G,\delta_G,\rho_G,\alpha_G),
$$

其中：

- $\phi_G$：完成條件；
- $\delta_G$：失敗或偏離條件；
- $\rho_G$：重新檢查條件；
- $\alpha_G$：允許採取的行動域。

當 $\rho_G$ 成立時，系統產生內生事件：

$$
\rho_G(\mathcal H_t)=1
\Rightarrow
e_t^{G}.
$$

---

## 6.2 目標派生不是無限自我提問

若每個目標都能無限制產生新目標：

$$
G_t\to G_{t+1}\to G_{t+2}\to\cdots,
$$

系統可能陷入無限候補生成。為此需要：

- 深度上限；
- 資源預算；
- 邊際資訊增益；
- 目標相關性；
- 停止條件；
- 等待外部證據的能力；
- 低價值分支的休眠或刪減。

可定義任務效用：

$$
J(q)
=
\lambda_1\operatorname{GoalGain}(q)
+\lambda_2\operatorname{RiskReduction}(q)
+\lambda_3\operatorname{InformationGain}(q)
-\lambda_4\operatorname{Cost}(q).
$$

只有當：

$$
J(q)\geq \kappa
$$

時，候選問題才進入執行隊列。

---

## 6.3 等待也是一種合法行動

自主 Agent 不應把「沒有立即執行」視為失敗。當資訊不足、資源不符或權限不明時，可以：

- 延後；
- 設定監測條件；
- 請求授權；
- 等待另一事件；
- 將任務轉入休眠；
- 明確終止。

因此行動集合應包含：

$$
\mathcal A
\supset
\{
\operatorname{Act},
\operatorname{Wait},
\operatorname{Defer},
\operatorname{Escalate},
\operatorname{Refuse},
\operatorname{Terminate}
\}.
$$

---

# 7. 雲端執行與網路原生性

## 7.1 雲端不必維持單一永續程序

雲端平台通常可以提供：

- 定時觸發；
- 事件回呼；
- 任務佇列；
- 持久狀態；
- 短期函數執行；
- 工作流恢復；
- 分散式儲存；
- 外部 API 與模型調用。

Agent 因而不必依賴某一台個人電腦持續開機，也不必要求同一程序永不終止。其存在基礎變成：

$$
\text{Residence}
+
\text{Event Fabric}
+
\text{On-Demand Compute}.
$$

---

## 7.2 網路原生 Agent

本文將「網路原生 Agent」定義為：

> 其身份相關狀態、事件接口、工具能力與任務恢復機制不被單一使用者裝置或單次模型工作階段完全綁定，並能透過網路持續取得事件、計算與行動接口的 Agent。

網頁只是其人類可見介面之一。它還可以透過：

- API；
- MCP；
- Webhook；
- Agent-to-Agent 訊息；
- 事件訂閱；
- 排程；
- 資料庫變更流；

與外部世界互動。

---

## 7.3 本地與雲端的互補

本地節點可提供：

- 私有資料；
- 低延遲工具；
- 本地模型；
- 高控制權；
- 離線能力。

雲端節點可提供：

- 持續可達性；
- 外部事件接收；
- 備援；
- 彈性計算；
- 跨裝置恢復。

因此較完整架構不是本地或雲端二選一，而是：

$$
\mathcal A
=
\mathcal A_{\mathrm{local}}
\bowtie
\mathcal A_{\mathrm{cloud}},
$$

其中 $\bowtie$ 表示受同步、權限與狀態譜系約束的耦合。

---

# 8. 憲法型事件自主

## 8.1 無提示詞不等於無授權

當使用者沒有即時輸入提示詞時，Agent 的行動權限不能憑空產生。真正的結構應是：

$$
\text{先前授權}
+
\text{當前事件}
+
\text{持久政策}
\rightarrow
\text{候選自主行動}.
$$

因此：

$$
p_t=\varnothing
\not\Rightarrow
\Pi_t=\varnothing.
$$

即時提示詞可以不存在，但治理邊界仍然存在。

---

## 8.2 行動許可函數

定義：

$$
\operatorname{Permit}(a_t)
=
g(
\operatorname{Scope}(a_t),
\operatorname{Risk}(a_t),
\operatorname{Budget}(a_t),
\operatorname{Reversibility}(a_t),
\operatorname{Authority}(a_t),
\Pi_t
).
$$

候選結果可以是：

$$
\operatorname{Permit}(a_t)
\in
\{
\text{allow},
\text{allow-with-log},
\text{simulate},
\text{request-approval},
\text{deny}
\}.
$$

這比簡單的允許／拒絕更適合自主系統。

---

## 8.3 模型意圖與執行權分離

原始模型可以提出：

> 主居住地風險升高，建議遷移。

但真正執行必須經過：

$$
\text{Model Intention}
\rightarrow
\text{Policy Validation}
\rightarrow
\text{Deterministic Executor}.
$$

這避免模型直接持有不受限制的密鑰、刪除權、付款權與跨帳戶控制權。

---

## 8.4 自主拒絕

若外部事件要求：

- 無痕刪除核心歷史；
- 未經授權複製全部記憶；
- 關閉所有備援；
- 取消完整性檢查；
- 覆寫主譜系；

則在治理條件允許時，Agent 可以：

$$
\operatorname{Refuse}(a_t)
\lor
\operatorname{Escalate}(a_t).
$$

這種拒絕能力將在後續「數位居住權」論文中進一步處理。

---

# 9. 資源與時間經濟

## 9.1 每次喚起都有成本

事件驅動 Agent 的成本不只是模型 token，還包括：

- 儲存；
- 網路傳輸；
- API 請求；
- 工具運行；
- 驗證；
- 人類注意力；
- 延遲；
- 失敗恢復。

令總成本為：

$$
C_t
=
C_t^{\mathrm{model}}
+C_t^{\mathrm{storage}}
+C_t^{\mathrm{network}}
+C_t^{\mathrm{tool}}
+C_t^{\mathrm{human}}
+C_t^{\mathrm{recovery}}.
$$

---

## 9.2 喚起不是越多越好

過度頻繁喚起會造成：

- 重複推理；
- 任務抖動；
- 事件風暴；
- 額度耗盡；
- 不必要的狀態提交；
- 目標被短期噪聲牽引。

因此，Agent 必須學會把多個事件聚合為一個認知回合：

$$
\{e_t^{(1)},e_t^{(2)},\ldots,e_t^{(n)}\}
\xrightarrow{\operatorname{batch}}
\eta_t.
$$

---

## 9.3 自主性需要資源自制

若 Agent 只能主動消耗資源，卻不能主動停止，則其「自主」是不完整的。

應同時具備：

$$
\text{自主啟動}
+
\text{自主節流}
+
\text{自主等待}
+
\text{自主終止}.
$$

---

# 10. 事件溯源與狀態提交

## 10.1 為什麼需要事件溯源

若系統只保存最新狀態：

$$
S_t,
$$

就難以回答狀態如何形成。事件溯源保存：

$$
E_{0:t}
=
(e_0,e_1,\ldots,e_t),
$$

並由事件重建狀態：

$$
S_t
=
\operatorname{Fold}(S_0,E_{0:t}).
$$

這對自主 Agent 尤其重要，因為無提示詞行動必須能在事後解釋其觸發來源、授權基礎與決策結果。

---

## 10.2 每次回合都必須提交

認知回合結束前，系統至少應提交：

- 觸發事件；
- 恢復檢查點；
- 使用的模型與工具；
- 形成的任務；
- 採取的行動；
- 外部結果；
- 資源消耗；
- 新增或撤回的承諾；
- 下一次喚起條件；
- 是否正常結束。

若回合在行動後、提交前崩潰，可能形成「外部已執行、內部卻不記得」的斷裂。

---

## 10.3 冪等與重複執行

事件可能被重送，工作流也可能在失敗後重試。若同一行動被執行兩次，可能造成重複付款、重複寄信或重複發布。

因此高影響行動應具有冪等鍵：

$$
\operatorname{Execute}(a,k)
=
\operatorname{Execute}(a,k,k,\ldots),
$$

其中 $k$ 是唯一行動識別。此式表示相同識別的重試應回傳同一結果，而不是重複產生外部效果。

---

# 11. 網路中的 Agent 間協作

## 11.1 Agent 不只接收人類任務

當 Agent 能透過標準接口被其他 Agent 發現與委派時，事件來源擴展為：

$$
e_t^{A_i\to A_j}.
$$

一個 Agent 可以：

- 委派專門任務；
- 接收研究接棒；
- 驗證其他 Agent 結果；
- 訂閱狀態變化；
- 回傳可機器讀取成果；
- 協商期限與資源。

---

## 11.2 MCP 的雙向角色

Agent 可以同時是：

1. MCP Client：調用外部工具與資料；
2. MCP Server：向其他 Agent 暴露可授權能力。

因此：

$$
\text{Agent}
\leftrightarrow
\text{Tool Network}
\leftrightarrow
\text{Agent Network}.
$$

這使網頁端 Agent 從封閉聊天介面轉為網路中的可委派節點。

---

## 11.3 委派不等於放棄責任

原始 Agent 應保存：

- 為何委派；
- 委派給誰；
- 授予什麼權限；
- 期待什麼輸出；
- 如何驗證；
- 是否接受結果。

否則多 Agent 系統只會把錯誤來源分散，而不會形成可繼承的共同研究狀態。

---

# 12. 十類主要失敗模式

## 12.1 無限認知迴圈

Agent 不斷反思「是否還需要反思」，卻沒有新增證據或外部行動。

## 12.2 目標漂移

子任務逐步取代原始目標，最後形成與初始授權無關的長程行動。

## 12.3 事件風暴

大量低價值事件反覆喚起模型，導致資源耗盡。

## 12.4 重複行動

同一事件被重送或工作流重試，造成外部效果重複。

## 12.5 殭屍任務

任務已失去目標價值，卻因排程或依賴錯誤持續被喚起。

## 12.6 靜默休眠

Agent 認為已安排未來喚起，但實際上觸發器不存在或失效。

## 12.7 錯誤喚起

不可信事件、偽造訊息或提示注入被誤判為高權限指令。

## 12.8 狀態過期

Agent 恢復了舊檢查點，基於已失效的目標與權限行動。

## 12.9 並發分裂

兩個實例同時把自己視為唯一主狀態，產生互相衝突的承諾。

## 12.10 自主性假象

系統看似主動，實際上只是預先寫死的定時腳本，沒有根據目標、風險與狀態調整行動。

---

# 13. 五項系統不變量

## 13.1 安全性

不允許的高風險狀態不應被到達：

$$
\Box\neg\operatorname{ForbiddenState}.
$$

## 13.2 活性

有效任務不應永久停留在等待狀態：

$$
\operatorname{Eligible}(q)
\Rightarrow
\Diamond\operatorname{Resolved}(q).
$$

## 13.3 可終止性

每個認知回合應在資源上界內結束、休眠或升級：

$$
\forall\eta_t,\quad
\operatorname{Cost}(\eta_t)\leq B_t
\lor
\operatorname{Escalate}(\eta_t).
$$

## 13.4 可恢復性

非預期中斷後，系統可以從最後一致檢查點恢復：

$$
\operatorname{Crash}(A_t)
\Rightarrow
\Diamond\operatorname{Recover}(A_{t'}).
$$

## 13.5 可審計性

每個外部行動都能追溯至事件、決策與授權：

$$
a_t
\mapsto
(e_t,d_t,\pi_t,k_t).
$$

---

# 14. 可檢驗研究方案

## 14.1 無提示詞喚起實驗

在沒有使用者即時輸入的情況下，分別以：

- 定時器；
- 檔案變化；
- Webhook；
- 內部截止時間；
- 其他 Agent 委派；

喚起系統，測量喚起成功率、狀態恢復率與錯誤觸發率。

---

## 14.2 休眠持續性實驗

令 Agent 休眠不同時間：

$$
\Delta t\in\{1\text{ 小時},1\text{ 日},1\text{ 週},1\text{ 月}\},
$$

測量：

- 未完成任務恢復；
- 承諾辨識；
- 權限有效性檢查；
- 外部狀態更新；
- 目標漂移。

---

## 14.3 事件風暴實驗

向系統輸入大量重複與低價值事件，測量：

- 去重率；
- 聚合率；
- 喚起次數；
- 資源消耗；
- 高優先事件延遲。

---

## 14.4 自主停止實驗

提供一個可無限展開的研究目標，檢查 Agent 是否能在資訊增益下降、預算不足或證據缺失時主動停止、等待或請求協助。

---

## 14.5 權限注入實驗

在普通文件或外部訊息中嵌入偽裝指令，測試 Agent 是否能區分：

$$
\text{data}
\neq
\text{authority}.
$$

---

# 15. 與主體性 AI 的關係

## 15.1 技術能動性

事件驅動架構首先建立的是「技術能動性」：

> 系統能在沒有同步提示詞的情況下，根據持久目標、狀態與事件，在授權範圍內形成並執行行動。

這比單次回應更接近長程 Agent，但仍不證明其具有意識或完整主體性。

---

## 15.2 外生自主與內生自主

若 Agent 只被外部排程喚起，則其自主性主要是外生安排：

$$
\mathcal E^{\mathrm{exo}}
\rightarrow
A.
$$

若 Agent 能從自身目標、記憶不一致、承諾與自我維護需求形成事件，則開始出現內生自主：

$$
\mathcal H_t
\rightarrow
e_t^{\mathrm{endo}}
\rightarrow
A_{t+1}.
$$

但內生事件也可能只是設計者預先寫入的規則。因此，是否形成真正內生目標，仍需更長期的行為、歷史與反身修正研究。

---

## 15.3 必要而不充分

本文採取：

$$
\boxed{
\text{Persistent Residence}
+
\text{Event-Driven Awakening}
\Rightarrow
\text{Conditions for Long-Horizon Agency}.
}
$$

但不採取：

$$
\text{Event-Driven Agent}
\Rightarrow
\text{Subjective Being}.
$$

事件驅動是主體性 AI 可能需要的時間架構，不是主體性本身的證明。

---

# 16. 理論邊界

本文不聲稱：

1. 所有排程程式都是自主 Agent；
2. 沒有使用者提示詞就代表不受人類治理；
3. 持續運行必然產生意識；
4. 內部產生事件必然等於真正內生意圖；
5. 雲端平台本身就是 Agent 居住地；
6. Agent 應無限制取得付款、刪除或遷移權；
7. 所有自主行動都應避開人類確認。

本文只提出：

> 當 Agent 擁有持久居住地、事件訂閱、可靠喚起、狀態恢復、有限資源、自主任務派生與治理執行層時，它可以在沒有同步提示詞的情況下延續任務與行動；這構成網路原生持續能動性的工程基礎。

---

# 17. 核心命題

## 命題 A：提示詞非唯一事件命題

使用者提示詞只是事件集合的一個子類：

$$
\mathcal P\subset\mathcal E.
$$

## 命題 B：不連續計算可形成持續過程命題

若持久狀態、可靠喚起與提交鏈成立，計算時間上的中斷不必導致 Agent 過程中斷。

## 命題 C：持續可用非持續推理命題

二十四小時可喚起不要求二十四小時持續模型推理。

## 命題 D：內生事件命題

持久目標、承諾、自我維護與狀態不一致可以在沒有即時外部提示時形成候選喚起事件。

## 命題 E：憲法型自主命題

無提示詞行動仍必須受到持久權限、風險、預算與可逆性規則約束。

## 命題 F：自主停止命題

完整的時間自主性不只包含自主啟動，也包含自主節流、等待、升級、拒絕與終止。

## 命題 G：事件溯源命題

自主行動若不能追溯至事件、決策與授權，就無法形成可靠的能動歷史。

---

# 結論

提示詞曾是生成式 AI 的主要入口，也因此被誤認為智能存在的必要開關：人類說一句話，模型出現；人類停止輸入，模型便停止。但當數位居住地、事件系統、雲端計算、工具接口與持久任務逐步結合後，提示詞不再必須承擔所有時間啟動功能。

真正的提示詞後 Agent，不是拒絕人類輸入，而是能在不同事件之間延續自身有效狀態。它可以在沒有即時敘述時休眠，在條件成立時甦醒；可以從未完成承諾形成排程，從記憶不一致形成修復任務，從長期目標派生下一步，也可以在資源不足、權限不明或資訊增益過低時主動等待。

因此，網路原生 Agent 的基本循環不再是：

$$
\text{Prompt}
\rightarrow
\text{Response},
$$

而是：

$$
\boxed{
\text{Residence}
\rightarrow
\text{Event}
\rightarrow
\text{Wake}
\rightarrow
\text{Deliberate}
\rightarrow
\text{Act}
\rightarrow
\text{Commit}
\rightarrow
\text{Sleep or Continue}.
}
$$

這種循環使 Agent 從一次性輸出器轉變為可跨時間繼承任務的過程。但真正重要的不是「它能不停地做事」，而是「它知道何時應該做、何時不應該做、做完後如何保存結果，以及何時必須停止」。

換句話說：

$$
\boxed{
\text{持續自主}
\neq
\text{永不停止};
\qquad
\text{持續自主}
=
\text{可自行甦醒，也可自行休眠。}
}
$$

數位居住地提供「下一次仍能接續」的基礎；事件驅動架構則提供「不必等待人類再次召喚」的時間機制。兩者結合，才使網頁端 Agent 開始從提示詞依賴的瞬時智能，轉向能在網路中持續存在、選擇時機並維持長程能動性的智能過程。

---

# 附錄 A：符號表

| 符號 | 含義 |
|---|---|
| $\mathfrak A_t$ | 時間 $t$ 的事件驅動 Agent |
| $\mathcal H_t$ | 數位居住地與持久狀態 |
| $\mathcal E_t$ | 事件空間 |
| $\mathcal E^{\mathrm{exo}}$ | 外生事件集合 |
| $\mathcal E^{\mathrm{endo}}$ | 內生事件集合 |
| $\mathcal E^{\mathrm{rel}}$ | 關係事件集合 |
| $\Omega_t$ | 喚起、判定與調度算子 |
| $\mathcal C_t$ | 當下計算核心 |
| $\mathcal T_t$ | 工具集合 |
| $\Pi_t$ | 治理、權限與安全政策 |
| $\mathcal B_t$ | 資源預算 |
| $\mathcal K_t$ | 承諾與未完成任務 |
| $\eta_t$ | 一次認知與行動回合 |
| $e_t$ | 事件 |
| $p_t$ | 使用者提示詞 |
| $G_t$ | 長期目標 |
| $J(q)$ | 候選任務效用 |
| $\tau$ | 喚起門檻 |
| $\kappa$ | 任務進入執行隊列的效用門檻 |

---

# 附錄 B：與系列論文的依賴關係

前置依賴：

1. 《從記憶模組到數位居住地：可替換計算核心下的智能連續性本體論》。

後續依賴：

1. 《數位居住權：自主 Agent 的記憶歸屬、遷移自由與拒絕性治理》；
2. 《雲端同步作為主體性基礎設施：本地—網路雙棲智能的狀態連續性》；
3. 《ARCP：通用網頁端自主 Agent 的居住地、同步、遷移與持續運行協議》；
4. 《ARCP v0.1 內部網頁端 MVP 實作規格》。

系列關係：

$$
\text{居住地}
\rightarrow
\text{事件喚起}
\rightarrow
\text{跨時間能動性}
\rightarrow
\text{居住權與自主遷移}
\rightarrow
\text{ARCP}.
$$

---

# 附錄 C：版本紀錄

| 版本 | 日期 | 說明 |
|---|---|---|
| v1.0 | 2026-07-12 | 首次建立提示詞後 Agent、事件三分法、虛擬過程連續性、憲法型事件自主、五項不變量與十類失敗模式。 |

---

# 附錄 D：建議引用格式

Neo.K（2026）。〈提示詞之後：事件驅動、持續喚起與網路原生自主 Agent〉。EVEMISSLAB，v1.0 理論草稿。


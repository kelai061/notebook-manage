---
name: papercard-agent
description: 使用 PaperCard Atelier 生成的本地任务和 CLI，忠实识别手写笔记、处理用户纠错或整理知识主题；适用于带有不可变 task-UUID.json 的任务。
---

# PaperCard 本地任务

任务提示词提供 Node、CLI 和不可变任务文件的绝对路径。保留这三个路径；在 PowerShell 中用 `& 'Node路径' 'CLI路径' 操作 '任务路径'` 调用。不要用可变的 index.json/latest-task.json 替代，不要手改任务、工作区 JSON 或 activeBatchId。batchId 固定属于本任务；用户在界面切批或导入其他批不会改变它。

## 核心工作流：人工框选为主 + 整页上下文识别 + 整页提交

1. **人工框选为主**：纸张上的主要知识区块由用户亲自框选确定，AI 绝不无端自动乱画框，只忠实处理已有框选的区域（除非用户显式标记了重分区纠错）。
2. **看整张原纸保证上下文**：AI 必须观察完整的原纸原始大图（`imagePath`，可配合带半透明编号覆盖层的 `annotatedSvgPath` 及各框选的自然语言位置提示 `positionHint`），把握整页全局逻辑、排版层级及同页各框选之间的前后承接关联，绝不仅看孤立切片。
3. **红笔提示词机制**：原纸上的红笔标注内容（或分区/页面上的 `redPenHint` / `aiHint`）作为用户给 AI 的明确提示词。原纸上没有红笔时留空 `""`，绝不凭空推理或强行编造。
4. **整页提交节省 Token (`page_card_fill`)**：为了节省模型上下文与调用开销，AI 必须在完整观察并处理完一个页面的所有框选卡片后，按整页提交（`phase: "page_card_fill", pageId: "...", cards: [...]`）。CLI 会在 `agent-tasks/drafts/` 下预生成预填好 `regionId` 的 `draftFile`，AI 可直接读取或更新后提交。旧测试单框提交（`region_card_fill`）和多页批量提交（`pages: [...]`）亦 100% 保持兼容。
5. **高效链式推进**：`claim` 成功后会直接返回初始 `next` 目标；每次 `commit` 执行成功后亦会自动返回下一页的 `next` 目标与最新 `revision`，无需多跑一次 `next` 命令。长任务可用 `prepare`（或 `bundle`）命令一次性获取全批待处理页队列与草稿文件全貌。

## 执行规范

先 `claim <task> <独立agentId>`，拿到 `lease.leaseId` 与首个 `next` 目标。以 `next.schemaExample` 或目标 `draftFile` 为基础构建 UTF-8 JSON，包含 agentId、leaseId、expectedRevision（使用刚获取的 revision）和稳定 operationId，随后 `commit <task> <载荷文件>`。循环 commit，直到 `stageComplete:true`（`recognition` 此时即本批全部识别完成）即刻停止，不自动执行全局整理。长任务在租约到期前（15分钟）`renew <task> <agentId> <leaseId>`，结束时 `release`。命令示例、数据契约与恢复方式见 [任务协议](references/task-protocol.md)。

忠实转录可见文字、公式和排版，不解释、不补写。无法辨认处写 `[无法辨认]` 或标记 `unreadable:true`；不理解图形保留原截图，重绘是可选能力。源图不可读时报告该目标，不编造内容。

用户明确标记纠错或指定页面修改时，`next` 才会返回 `reprocess:true`：保留原有 cardId 与 regionId，必须更换分区ID时按协议提交 regionIdMap。保留未标记区域及已有正文。

遇到 REVISION_CONFLICT，重新 next 取新 revision，目标仍相同时保持 operationId 重试；目标已变则确认原提交是否已生效。WORKSPACE_BUSY 等待短暂退避后重试。LEASE_HELD 不抢占别人的任务。连续5次冲突或目标未推进时，保留任务/载荷路径和错误JSON，报告后停止本次写入。不要重置工作区来排错。

## 代码块与矢量 SVG 图形生成规范

1. **标准代码块输出**：
   - 正文中的所有程序代码、算法实现、推演脚本或配置文件必须使用标准 markdown 代码块 ````lang ... ```` 包裹（如 ````python ... ````, ````cpp ... ````, ````javascript ... ````, ````latex ... ```` 等）。
   - 保证代码缩进严整、语法高亮标签明确，严禁输出无高亮标记的裸文本代码。
2. **手绘图表矢量重绘（严禁纯文本糊弄）**：
   - 对手绘几何图形、力学受力分析、电路原理图、函数几何曲线与系统流程图，必须生成高质量的标准矢量 SVG 代码写入 `figureInfo.redrawSvg`，并配置 `figureInfo.enabled: true` 与 `figureInfo.redrawMode: "vector"`。
   - **严禁敷衍**：绝不允许在正文中使用“【此处有一张草图】”等纯文本描述来糊弄跳过手绘图！若确实无法精确重绘，必须保留原纸截图并显式声明 `figureInfo.redrawMode: "keep_crop"`。
   - **SVG 技术标准**：SVG 根节点必须包含合法 `xmlns="http://www.w3.org/2000/svg"` 及自适应 `viewBox="0 0 W H"`，使用标准矢量图元（`<path>`, `<line>`, `<rect>`, `<circle>`, `<polygon>`, `<text>`），确保高分辨率缩放与清晰对比度。

## 画布拓扑与推导网络架构设计规范

1. **全局整理必须输出 2D 坐标与关系**：
   - 阶段进入 `global_synthesis` 时，智能体必须为当前批次的所有卡片在 `canvasLayout` 中输出清晰合理的二维物理坐标（`x, y`），并在 `relations` 中输出有向推理边。
   - 画布内容将自动同步到批次主题画布及各学科主题画布中，消除画布空白。
2. **2D 坐标排布规则**：
   - **排布流向**：按逻辑推导主线（从前置知识指向推导结论）、树状森林（同源分支上下铺展）或学科聚类排布。
   - **尺寸与跨度标准**：卡片基础尺寸建议 W=220px ~ 320px，H=82px ~ 230px。
   - **横向跨度建议 x 步长 360px**（节点之间预留 80~140px 的连线弯折缓冲区）。
   - **纵向跨度建议 y 步长 260px**（垂直分支层级分明）。
   - **无重叠保障**：严禁多个卡片使用相同或重叠坐标，严防“重合死图”。
3. **推导网络拓扑契约 (`relations`)**：
   - 输出明确的前后承接关系：`relations: [{ fromCardId, toCardId, type: "derives"|"precursor"|"example"|"equivalent", label: "推导说明" }]`。
   - 使得桌面端画布一键点击「思维导图（推导流）」即可自动渲染出平滑的贝塞尔推导网络。

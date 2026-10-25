# CLI 载荷与任务协议

下列变量使用提示词给出的绝对路径。使用明确 Node 可执行文件，避免系统 shim：

```powershell
$nodeExe = '提示词中的Node绝对路径'
$cliFile = '提示词中的CLI绝对路径'
$taskFile = '提示词中的task-UUID.json绝对路径'
$workerId = '每个任务独立的worker名称'

# 1. Claim 任务并同时获取初始目标（claim 自动返回 lease 与首个 next）
$claim = (& $nodeExe $cliFile claim $taskFile $workerId) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'claim失败，读取错误JSON后处理' }
$leaseId = $claim.lease.leaseId
$step = $claim.next

# 2. 批量准备模式（可选）：一次性查看所有待处理页、预生成的标注 SVG 与草稿模板
# $bundle = (& $nodeExe $cliFile prepare $taskFile) | ConvertFrom-Json

# 3. 循环整页处理与提交（commit 成功后自动链式返回下一页的 next 与最新 revision）
while ($step -and -not $step.stageComplete -and -not $step.complete) {
    # 观察原图（$step.target.imagePath）及框选标号图（$step.target.annotatedSvgPath）
    # 可直接读取预生成的草稿文件：$draft = Get-Content $step.target.draftFile | ConvertFrom-Json
    $payload = $step.schemaExample
    $payload | Add-Member agentId $workerId -Force
    $payload | Add-Member leaseId $leaseId -Force
    
    # 填写真实识别文字、公式与红笔提示词，保存并提交
    $payloadFile = "payload-$($step.target.pageId).json"
    $payload | ConvertTo-Json -Depth 40 | Set-Content -Encoding utf8 $payloadFile
    $commitRes = (& $nodeExe $cliFile commit $taskFile $payloadFile) | ConvertFrom-Json
    
    # commit 自动返回下一页目标 next
    $step = $commitRes.next
}
```

## 载荷契约说明

### 1. 整页提交 (`page_card_fill`) 【推荐，省 Token 且保证页面上下文】
- **顶层字段**：`phase: "page_card_fill"`, `pageId`, `pageSummary`, `cards: [...]`, `reprocess`, `expectedRevision`, `operationId`, `agentId`, `leaseId`。
- **每张卡片项 (`cards[]`)**：
  - `regionId`（必填，对应框选 ID）
  - `title`（具名标题）
  - `editableContent`（可编辑结构化正文与公式）
  - `structureBlocks`（结构化块数组）
  - `intraPageLinks`（同页关联数组，无关联传 `[]`）
  - `crossPageHypotheses`（跨页推测数组，无关联传 `[]`）
  - `redPenHint` / `aiHint`（原纸红笔内容或 AI 提示词，无红笔时留空字符串 `""`）
  - `figureInfo`（图形处理规范）：
    - 原纸手绘图必须生成标准矢量 SVG：`{ enabled: true, redrawMode: "vector", redrawSvg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 600 400\">...</svg>" }`。
    - **严禁纯文本糊弄**：不得用文字描述替代绘图。若无法精确重绘，应保留原图截图：`{ enabled: false, redrawMode: "keep_crop" }`。
    - 正文代码必须使用标准高亮语法块（如 ````python ... ````, ````cpp ... ````, ````latex ... ````）。
- **多页批量提交**：亦支持直接提交 `{ pages: [{ pageId, cards: [...] }, ...], agentId, leaseId, expectedRevision, operationId }`，单次事务写入多页。
- **单框提交兼容 (`region_card_fill`)**：针对旧测试或单框精细重修，顶层传 `phase: "region_card_fill"` 及单个 `regionId` 仍完全受支持。

### 2. 页面分区 (`page_partition`) 【旧模式 / 纠错重画框】
- `phase: "page_partition"`, `pageId`, `pageSummary`, `regions: [{ regionId, kind, bbox, points }]`。
- 在默认人工框选工作流中，AI 不自动触发分区；仅在用户标记纠错或明确要求重新分区时执行。重新画框须 `reprocess: true`，且须保留已有 `regionId` 或传入 `regionIdMap`。

### 3. 全局合成与全库整理 (`global_synthesis` / `knowledge_synthesis`)
- **`global_synthesis`（批次整理）**：整理本任务批次卡片的推导网络、2D 画布坐标、题解树与学科分类。
  - **载荷顶级字段**：
    ```json
    {
      "phase": "global_synthesis",
      "expectedRevision": 12,
      "operationId": "op-synthesis-uuid",
      "canvasLayout": [
        { "cardId": "card-1", "x": 80, "y": 80, "w": 220, "h": 82, "cluster": "数学" },
        { "cardId": "card-2", "x": 440, "y": 80, "w": 220, "h": 82, "cluster": "数学" },
        { "cardId": "card-3", "x": 80, "y": 340, "w": 220, "h": 82, "cluster": "物理" }
      ],
      "relations": [
        { "fromCardId": "card-1", "toCardId": "card-2", "type": "derives", "label": "泰勒展开推导" }
      ],
      "taxonomyAssignments": [
        { "cardId": "card-1", "subject": "数学", "course": "高数", "chapter": "级数" },
        { "cardId": "card-2", "subject": "数学", "course": "高数", "chapter": "级数" },
        { "cardId": "card-3", "subject": "物理", "course": "力学", "chapter": "谐振动" }
      ],
      "problemTrees": []
    }
    ```
  - **2D 坐标排布规则**：
    - 横向 x 步长建议 360px（留出连线弯折通道），纵向 y 步长建议 260px。
    - 所有节点坐标互不重叠，按因果推导流自左向右展开。
  - **自动同步机制**：后端 `store.js` 会自动将 `canvasLayout` 与 `relations` 写入批次主题画布及按学科分类生成的学科画布，前端画布即时可见完整思维导图。
- **`knowledge_synthesis`（全库跨批整理）**：显式全库任务，增量维护主题画布 `canvases`、全局分类 `taxonomyAssignments` 与跨批次关系 `relations`。

## 续接与租约
长任务在租约到期前（15分钟）执行 `renew <task> <agentId> [leaseId]`。完成或退出时执行 `release <task> <agentId> [leaseId]`。如遇 REVISION_CONFLICT，使用最新 revision 和相同 operationId 重试；WORKSPACE_BUSY 短暂退避后重试；LEASE_HELD 表示其他 worker 在执行，不抢占。

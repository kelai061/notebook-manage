# PaperCard Atelier 任务追踪表 (tasks/todo.md)

- [x] **T1. 交互项目规范化迁移与第2轮技能登记** (`ob-project-agent`)
  - 将 `未命名.md` 规范迁移为 `可莱/交互.md`，同步 `Agent/会话索引.json` 与 `Agent/当前状态.json`，并在 `Agent/技能使用.jsonl` 中登记核心技能。
- [x] **T2. 制定大型桌面软件工程规范与契约升级** (`spec-driven-development`, `planning-and-task-breakdown`)
  - 编写 `SPEC.md`、`tasks/plan.md`、`tasks/todo.md`，升级 `src/shared/contracts.js`（新增 `CARD_NATURES`、`IPC_CHANNELS`、`validateRevisionConflict`、`validateCardSplitPayload`、`validateCardMergePayload`）。
- [x] **T3. 主从智能体本地桌面架构优劣评审与选型定稿** (`ADR-001`)
  - 与 3 个子智能体（2×`pro` + 1×`flash`）共同评估候选本地桌面方案，汇总输出 `docs/ADR-001-本地桌面架构选型.md`。
- [x] **T4. 存储引擎、乐观并发、四层卡片模型与 CLI 租约升级** (`Subagent 1 · pro`)
  - 升级 `src/main/store.js`、`src/main/agentPrompt.js`、`src/cli/noteTasks.js`。
- [x] **T5. Electron 原生主进程、`app://` 协议、Preload IPC 与前端交互升级** (`Subagent 2 · flash`)
  - 实现 `src/main/assetProtocol.js`、`src/main/preload.js`、`src/main/ipc.js`、`src/main/main.js` 及 `src/renderer/js/api.js`、`app.js`、`cardEditor.js`、`canvas.js`。
- [x] **T6. 桌面无边框窗口 UI、交互 BBox 视图与双轨对比台视觉升级** (`Subagent 3 · pro`)
  - 升级 `src/renderer/index.html`、`src/renderer/styles/tokens.css`、`src/renderer/styles/app.css`。
- [x] **T7. 完整本地启动程序（`.exe` / `.cmd` / `.vbs`）构建与桌面端自动化场景验收** (`Leader Agent`)
  - 编写并执行 `scripts/build-desktop.js` 与 `scripts/scenarios/verify-desktop.js`，运行扩充后的全量测试套件（8/8 通过）并截取真实桌面运行图 `docs/shots/01..04.png`。
- [x] **T8. 项目经理五维代码与完成度审查报告及 Obsidian 第2轮发布** (`code-review-and-quality`, `evaluation`)
  - 编写 `docs/项目经理审查与验收报告.md` 与 `Agent/回复可莱/未命名-5d440e0c/回复-002.md`，校验并发布 `可莱/交互.md` 第2轮。

## 第4轮（2026-10-25）

- [x] 忠实转录与单阶段CLI、批次和知识库持久化
- [x] 真实公式与媒体预览、编辑器和旧能力回归
- [x] 纸张/多边形分区、可编辑目录、轻量知识节点
- [x] 27项自动化测试、33项真实桌面行为、6张截图审查
- [x] 数据保护校验、重新打包与执行记录回填

证据：`docs/第4轮交付与验证.md`、`docs/r4-verification/`。

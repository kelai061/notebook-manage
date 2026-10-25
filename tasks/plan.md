# PaperCard Atelier 第2轮大型桌面工程拆解与执行计划 (tasks/plan.md)

## 1. 阶段拆解 (Phased Implementation Plan)

### Slice 1：核心数据契约与架构决策 (Leader Agent)
- **目标**：升级 `src/shared/contracts.js`（新增 `CARD_NATURES`、`IPC_CHANNELS`、乐观锁 `validateRevisionConflict`、卡片拆分/合并校验 `validateCardSplitPayload` / `validateCardMergePayload`），并完成主从智能体对本地桌面架构的优劣评审（输出 `docs/ADR-001-本地桌面架构选型.md`）。
- **验证标准**：契约导出完整，所有子智能体与测试共用同一份契约定义。

### Slice 2：存储引擎、乐观并发、卡片拆分合并与三阶段 CLI 升级 (Subagent 1 · `pro`)
- **目标**：
  - 升级 `src/main/store.js`：引入 `state.revision` 与 `expectedRevision` 乐观并发检测、`operationLog` 幂等控制；补齐 `transcript`、`paraphrase`、`redInstruction`、`unresolved`、`nature`、`confidence`；实现 `splitCard`、`mergeCards`、`cropRegion`、`importLocalFiles`、`exportSnapshot`。
  - 升级 `src/main/agentPrompt.js`：输出包含 `node` 与 `ELECTRON_RUN_AS_NODE=1` 双执行入口提示词，涵盖四层手写卡片转录规范。
  - 升级 `src/cli/noteTasks.js`：新增任务批次租约 `claim / renew / release`、区域截图提取 `crop`，支持 `--expected-revision` 与 `--op-id`。
- **验证标准**：全部 CLI 子命令与 Store 新增方法通过自动化契约与并发测试。

### Slice 3：Electron 原生桌面主进程、`app://` 协议、Preload IPC 与交互桥接 (Subagent 2 · `flash`)
- **目标**：
  - 构建 `src/main/assetProtocol.js`、`src/main/preload.js`、`src/main/ipc.js`、`src/main/main.js`，彻底替代网页端口模式。
  - 构建 `src/renderer/js/api.js` 统一调用 `window.papercard.call(channel, payload)`。
  - 升级 `src/renderer/js/app.js`、`cardEditor.js`、`canvas.js`，支持原纸交互式 BBox 绘制/调整、原生文件选择导入、卡片拆分与合并、四层内容编辑、画布多选对齐与批量合并。
- **验证标准**：无需启动任何 HTTP 端口，Electron 窗口通过 `app://local/index.html` 加载并完成全部 19 个 IPC 通道读写。

### Slice 4：桌面级 UI 视觉、无边框窗口拖拽栏与双轨工作台布局 (Subagent 3 · `pro`)
- **目标**：
  - 升级 `src/renderer/index.html`、`src/renderer/styles/tokens.css`、`src/renderer/styles/app.css`。
  - 适配 Electron `titleBarOverlay` 顶部拖拽区（`-webkit-app-region: drag`），新增原纸交互 BBox 工具栏、四层手写卡片对照面板、拆分/合并交互控件、图形裁剪与重绘并排对比台、画布批量操作栏及桌面状态底栏。
- **验证标准**：UI 结构测试通过，且在 Electron 真实窗口下渲染无遮挡、无错位。

### Slice 5：完整启动程序构建、自动化桌面场景验收与项目经理五维审查 (Leader Agent)
- **目标**：
  - 编写 `scripts/build-desktop.js`，生成 `release/PaperCardAtelier/PaperCardAtelier.exe` 独立桌面运行包与根目录原生 Win32 启动程序 `PaperCardAtelier.exe`（由 `csc.exe /target:winexe` 编译）、`启动工作台.cmd`、`PaperCardAtelier.vbs`、`创建桌面快捷方式.cmd`。
  - 编写 `scripts/scenarios/verify-desktop.js` 与完整测试套件 `tests/*.test.js`，运行真实桌面端无人值守验证并截取实机窗口画面 `docs/shots/*.png`。
  - 出具《项目经理审查与验收报告》（`docs/项目经理审查与验收报告.md`），同步更新 Obsidian 交互文档与验证记录。

## 第4轮（2026-10-25）

- [x] 忠实转录与单阶段CLI、批次和知识库持久化
- [x] 真实公式与媒体预览、编辑器和旧能力回归
- [x] 纸张/多边形分区、可编辑目录、轻量知识节点
- [x] 27项自动化测试、33项真实桌面行为、6张截图审查
- [x] 数据保护校验、重新打包与执行记录回填

证据：`docs/第4轮交付与验证.md`、`docs/r4-verification/`。

'use strict';
/**
 * server.js — 本地服务桥接层（零外部依赖，基于 Node.js 原生 http / fs / path / child_process）
 * 
 * 核心功能：
 * 1. 静态资源托管：映射 / 到 src/renderer/index.html，静态分发 CSS, JS, SVG, 截图片段
 * 2. 对标 SkillAtelier 的提示词复制与剪贴板同步 (/api/prompt/copy)
 * 3. 工作区状态持久化与卡片增删改查 REST API (/api/state, /api/cards, /api/canvas/layout)
 * 4. 三阶段智能体状态机分步模拟演进 API (/api/agent/simulate-step)
 * 5. 导出 { createAppServer } 便于程序化调用与单元测试
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const contracts = require('./shared/contracts');
const { createWorkspaceStore } = require('./main/store');
const { buildAgentInstruction } = require('./main/agentPrompt');
const noteTasks = require('./cli/noteTasks');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * 创建应用服务实例
 * @param {Object} options 配置选项 { port, workspaceDir, ws }
 */
function createAppServer(options = {}) {
  const port = options.port || Number(process.env.PORT) || 4399;
  const projectRoot = path.resolve(__dirname, '..');
  const rendererDir = path.join(__dirname, 'renderer');
  const defaultWorkspaceDir = path.join(projectRoot, 'workspace');

  // 初始化持久化存储
  const workspaceDir = options.workspaceDir || defaultWorkspaceDir;
  const ws = options.ws || createWorkspaceStore(workspaceDir, { seedDemo: true });

  /**
   * 辅助函数：解析请求 Body JSON
   */
  function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 20 * 1024 * 1024) {
          req.destroy();
          reject(new Error('请求体过大（超限 20MB）'));
        }
      });
      req.on('end', () => {
        if (!body.trim()) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`JSON 格式无效: ${err.message}`));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * 辅助函数：快速发送 JSON 响应
   */
  function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
  }

  /**
   * 辅助函数：快速发送静态文件
   */
  function serveStaticFile(res, filePath) {
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 Not Found');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    // 跨域预检处理
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }

    const parsedUrl = new URL(req.url, `http://localhost:${port}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    try {
      // ============================================================
      // REST API 路由
      // ============================================================

      // 1. 获取全局状态与任务进度
      if (req.method === 'GET' && pathname === '/api/state') {
        const instruction = buildAgentInstruction(ws);
        const status = noteTasks.status(instruction.taskFile);
        return sendJson(res, 200, {
          success: true,
          state: ws.getState(),
          status,
          phase: status.phase
        });
      }

      // 2. 复制智能体识别提示词指令（对标 SkillAtelier）
      if (req.method === 'POST' && pathname === '/api/prompt/copy') {
        const instruction = buildAgentInstruction(ws);
        
        // 尝试通过 Windows clip 命令行同步写入系统剪贴板（若平台支持）
        let clipSynced = false;
        if (process.platform === 'win32') {
          try {
            const clipProcess = spawnSync('clip', {
              input: instruction.text,
              encoding: 'utf8',
              timeout: 1000
            });
            clipSynced = clipProcess.status === 0;
          } catch (clipErr) {
            // clip 命令失败不阻塞返回，前端通过 navigator.clipboard.writeText 兜底
          }
        }

        return sendJson(res, 200, {
          success: true,
          clipSynced,
          instruction,
          text: instruction.text,
          taskFile: instruction.taskFile,
          phase: instruction.phase
        });
      }

      // 3. 导入手写纸张
      if (req.method === 'POST' && pathname === '/api/pages/import') {
        const body = await parseJsonBody(req);
        const page = ws.importPage(body);
        return sendJson(res, 200, {
          success: true,
          page,
          state: ws.getState()
        });
      }

      // 4. 新增卡片
      if (req.method === 'POST' && pathname === '/api/cards') {
        const body = await parseJsonBody(req);
        const card = ws.addCard(body);
        return sendJson(res, 200, {
          success: true,
          card,
          state: ws.getState()
        });
      }

      // 5. 更新卡片 PATCH /api/cards/:cardId
      if (req.method === 'PATCH' && pathname.startsWith('/api/cards/')) {
        const cardId = pathname.replace('/api/cards/', '').trim();
        const body = await parseJsonBody(req);
        const card = ws.updateCard(cardId, body);
        return sendJson(res, 200, {
          success: true,
          card,
          state: ws.getState()
        });
      }

      // 6. 删除卡片 DELETE /api/cards/:cardId
      if (req.method === 'DELETE' && pathname.startsWith('/api/cards/')) {
        const cardId = pathname.replace('/api/cards/', '').trim();
        const success = ws.deleteCard(cardId);
        return sendJson(res, 200, {
          success,
          cardId,
          state: ws.getState()
        });
      }

      // 7. 更新自由画布排布坐标
      if (req.method === 'POST' && pathname === '/api/canvas/layout') {
        const body = await parseJsonBody(req);
        const layout = ws.updateCanvasLayout(body.positions || []);
        return sendJson(res, 200, {
          success: true,
          layout,
          state: ws.getState()
        });
      }

      // 8. 演示智能体分步执行 (模拟外部 Agent 执行 next & commit 推进三阶段)
      if (req.method === 'POST' && pathname === '/api/agent/simulate-step') {
        const instruction = buildAgentInstruction(ws);
        const step = noteTasks.next(instruction.taskFile);
        let actionReport = '';

        if (step.phase === contracts.PHASES.PAGE_PARTITION) {
          const targetPage = step.target;
          const sampleRegions = [
            {
              regionId: `${targetPage.pageId}-r1`,
              kind: 'problem',
              label: '例题题干：已知三次函数求驻点与极值',
              bbox: { x: 0.08, y: 0.06, w: 0.84, h: 0.22 }
            },
            {
              regionId: `${targetPage.pageId}-r2`,
              kind: 'process',
              label: '一阶导数计算与单调区间推导',
              bbox: { x: 0.08, y: 0.31, w: 0.48, h: 0.42 }
            },
            {
              regionId: `${targetPage.pageId}-r3`,
              kind: 'figure',
              label: '手绘函数草图与极值水平切线',
              bbox: { x: 0.60, y: 0.31, w: 0.32, h: 0.35 }
            },
            {
              regionId: `${targetPage.pageId}-r4`,
              kind: 'key_step',
              label: '二阶导数拐点判别核心结论',
              bbox: { x: 0.08, y: 0.76, w: 0.84, h: 0.18 }
            }
          ];

          noteTasks.commit(instruction.taskFile, {
            phase: contracts.PHASES.PAGE_PARTITION,
            pageId: targetPage.pageId,
            pageSummary: `完成手写纸张 ${targetPage.title || targetPage.pageId} 的全页扫描与内容网格划分`,
            regions: sampleRegions
          });
          actionReport = `已完成第 1 阶段【逐页识别与分区】：页面 ${targetPage.pageId} 拆分为 4 个独立手写区块`;
        } else if (step.phase === contracts.PHASES.REGION_CARD_FILL) {
          const target = step.target;
          const isProblem = target.kind === 'problem';
          const isFigure = target.kind === 'figure';
          const isKeyStep = target.kind === 'key_step';

          const title = isProblem ? `题目：三次函数极值与拐点综合题`
            : isFigure ? `配图：三次函数草图与极值点切线`
            : isKeyStep ? `关键过程：拐点坐标判别 $(1, -6)$`
            : `过程：一阶导数驻点列式 $f'(x)=3x^2-6x-9=0$`;

          const content = isProblem
            ? `设函数 $f(x) = x^3 - 3x^2 - 9x + 5$，求：\n(1) 函数的驻点与极值点；\n(2) 确定函数的单调区间与曲线凹凸性。`
            : isFigure
            ? `手绘三次函数几何草图。函数在 $x=-1$ 处有局部极大值 $10$；在 $x=3$ 处有局部极小值 $-22$。`
            : isKeyStep
            ? `求二阶导数：$$f''(x) = 6x - 6 = 6(x-1)$$\n当 $x > 1$ 时 $f''(x) > 0$（曲线凹）；\n当 $x < 1$ 时 $f''(x) < 0$（曲线凸）；\n因此点 $(1, -6)$ 为曲线的唯一拐点。`
            : `对 $f(x)$ 求导：$$f'(x) = 3x^2 - 6x - 9 = 3(x-3)(x+1)$$\n令 $f'(x) = 0$，解得驻点 $x_1 = -1, x_2 = 3$。`;

          noteTasks.commit(instruction.taskFile, {
            phase: contracts.PHASES.REGION_CARD_FILL,
            pageId: target.pageId,
            regionId: target.regionId,
            title,
            editableContent: content,
            typography: {
              headingScale: isProblem ? 1.3 : isKeyStep ? 1.15 : 1.0,
              bodyScale: 1.0,
              alignment: 'left',
              preserveLineBreaks: true
            },
            structureBlocks: [
              {
                kind: target.kind,
                text: `结构分析 [${target.kind}] ${title}`,
                latex: isProblem ? 'f(x)=x^3-3x^2-9x+5' : isKeyStep ? "f''(x)=6(x-1)" : "f'(x)=3(x-3)(x+1)"
              }
            ],
            figureInfo: isFigure ? {
              cropSvg: '<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg"><path d="M20,120 Q60,10 100,70 T180,20" fill="none" stroke="#2563eb" stroke-width="2.5"/><circle cx="65" cy="40" r="4" fill="#dc2626"/><text x="75" y="42" font-size="11" fill="#dc2626">极大值(-1,10)</text><circle cx="135" cy="100" r="4" fill="#16a34a"/><text x="145" y="105" font-size="11" fill="#16a34a">极小值(3,-22)</text></svg>',
              redrawMode: 'svg_redraw',
              redrawRule: '重绘为三次函数光滑矢量曲线，标出极值水平切线与拐点对称中心'
            } : null,
            intraPageLinks: !isProblem ? [{ targetRegionId: `${target.pageId}-r1`, type: 'belongs_to_problem', note: '归属于题干' }] : [],
            crossPageHypotheses: isKeyStep ? [{ targetPageId: target.pageId, targetRegionId: `${target.pageId}-r2`, type: 'cross_page_cont', confidence: 0.96, reason: '承接一阶导数计算结果' }] : []
          });
          actionReport = `已完成第 2 阶段【逐卡填入】：为分区 [${target.pageId} / ${target.regionId}] 生成可编辑卡片、LaTeX 与关联推测`;
        } else if (step.phase === contracts.PHASES.GLOBAL_SYNTHESIS) {
          const cardIds = step.target.cardIds || [];
          const stateCards = ws.getState().cards || [];
          const problemCard = stateCards.find((c) => c.kind === 'problem');
          const probId = problemCard ? problemCard.cardId : cardIds[0];

          noteTasks.commit(instruction.taskFile, {
            phase: contracts.PHASES.GLOBAL_SYNTHESIS,
            relations: cardIds.map((cid, i) => ({
              fromCardId: cid,
              toCardId: probId,
              type: i === 0 ? 'related_topic' : 'belongs_to_problem',
              label: i === 0 ? '核心题目' : '解题推导归属'
            })),
            problemTrees: [
              {
                problemCardId: probId,
                processCardIds: cardIds.filter((id) => id !== probId),
                keyStepCardIds: [],
                figureCardIds: [],
                thoughtCardIds: []
              }
            ],
            canvasLayout: cardIds.map((cid, i) => ({
              cardId: cid,
              x: 80 + (i % 3) * 360,
              y: 80 + Math.floor(i / 3) * 280,
              w: 320,
              h: 220,
              cluster: 'cluster-demo'
            })),
            taxonomyAssignments: cardIds.map((cid) => ({
              cardId: cid,
              subject: '数学',
              course: '高等数学',
              chapter: '第三章 微分中值定理与导数的应用',
              contentType: '题解卡片',
              tags: ['微积分', '极值与拐点']
            }))
          });
          actionReport = `已完成第 3 阶段【全局合成】：构建题解结构树、自由画布排布坐标与学科章节分类`;
        } else {
          actionReport = `三阶段全部完成！已构建完整的可编辑卡片、结构树与自由画布`;
        }

        const nextStatus = noteTasks.status(instruction.taskFile);
        return sendJson(res, 200, {
          success: true,
          phase: step.phase,
          actionReport,
          state: ws.getState(),
          status: nextStatus
        });
      }

      // 9. 重置工作区为示例演示数据
      if (req.method === 'POST' && pathname === '/api/workspace/reset') {
        const nextState = ws.resetToDemo();
        return sendJson(res, 200, {
          success: true,
          state: nextState,
          message: '工作区已成功重置为标准手写笔记示例'
        });
      }

      // ============================================================
      // 静态资源文件分发
      // ============================================================
      if (req.method === 'GET') {
        let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
        let targetFilePath = path.join(rendererDir, relativePath);

        // 如果请求以 /crops/ 开头，从 workspaceDir/crops 中寻找
        if (pathname.startsWith('/crops/')) {
          targetFilePath = path.join(workspaceDir, relativePath);
        }

        // 安全检查：防止目录穿越
        if (!targetFilePath.startsWith(rendererDir) && !targetFilePath.startsWith(workspaceDir)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('403 Forbidden');
        }

        return serveStaticFile(res, targetFilePath);
      }

      // 路由未命中
      sendJson(res, 404, { error: 'Not Found', path: pathname });
    } catch (routeErr) {
      console.error('[PaperCard Atelier Server Error]', routeErr);
      sendJson(res, 500, { error: routeErr.message || '服务器内部异常' });
    }
  });

  return {
    server,
    ws,
    port,
    listen(callback) {
      return server.listen(port, callback);
    },
    close(callback) {
      return server.close(callback);
    }
  };
}

// 支持直接 node src/server.js 启动
if (require.main === module) {
  const app = createAppServer();
  app.listen(() => {
    console.log(`\n============================================================`);
    console.log(`  PaperCard Atelier · 纸质手写笔记重构工作台本地服务已就绪`);
    console.log(`  访问地址: http://localhost:${app.port}`);
    console.log(`  提示词复制与 CLI 桥接: http://localhost:${app.port}/api/prompt/copy`);
    console.log(`============================================================\n`);
  });
}

module.exports = {
  createAppServer
};

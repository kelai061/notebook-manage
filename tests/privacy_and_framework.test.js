'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createWorkspaceStore } = require('../src/main/store');

const ROOT = path.resolve(__dirname, '..');
const WS_DIR = path.join(ROOT, 'workspace');
const TEMPLATE_FILE = path.join(WS_DIR, 'workspace-state.template.json');

test('Framework Template: 存在干净可初始化的框架状态模板且不含任何私有数据', () => {
  assert.ok(fs.existsSync(TEMPLATE_FILE), 'workspace/workspace-state.template.json 必须存在');

  const content = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  const template = JSON.parse(content);

  assert.ok(template.schemaVersion >= 6, 'schemaVersion 需大于等于 6');
  assert.equal(template.revision, 1, 'revision 初始版本号应为 1');
  assert.ok(Array.isArray(template.batches), 'batches 必须是数组');
  assert.equal(template.batches.length, 0, '框架模板中 batches 必须为空数组');
  assert.ok(Array.isArray(template.pages), 'pages 必须是数组');
  assert.equal(template.pages.length, 0, '框架模板中 pages 必须为空数组');
  assert.ok(Array.isArray(template.cards), 'cards 必须是数组');
  assert.equal(template.cards.length, 0, '框架模板中 cards 必须为空数组');
  assert.ok(Array.isArray(template.canvases), 'canvases 必须是数组');
  assert.equal(template.canvases.length, 0, '框架模板中 canvases 必须为空数组');
  assert.ok(Array.isArray(template.regions), 'regions 必须是数组');
  assert.equal(template.regions.length, 0, '框架模板中 regions 必须为空数组');
});

test('Framework Store Initialization: 在全新干净环境中自动通过模板初始化纯净框架', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-clean-init-'));
  try {
    fs.copyFileSync(TEMPLATE_FILE, path.join(tmpDir, 'workspace-state.template.json'));

    const store = createWorkspaceStore(tmpDir);
    const state = store.getState();

    assert.ok(state, '成功初始化工作区状态');
    assert.equal(state.pages.length, 0, '新工作区页面数应为 0');
    assert.equal(state.cards.length, 0, '新工作区卡片数应为 0');
    assert.equal(state.batches.length, 0, '新工作区批次数应为 0');
    assert.equal(state.canvases.length, 0, '新工作区画布数应为 0');
    assert.equal(state.synthesis, null, '新工作区全局综合体应为 null');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Privacy Protection: Git 跟踪列表与工作区中 0 私有图片与 0 用户私有笔记', () => {
  // 检查 .gitkeep 存在性
  assert.ok(fs.existsSync(path.join(WS_DIR, 'pages', '.gitkeep')), 'workspace/pages/.gitkeep 必须存在');
  assert.ok(fs.existsSync(path.join(WS_DIR, 'crops', '.gitkeep')), 'workspace/crops/.gitkeep 必须存在');
  assert.ok(fs.existsSync(path.join(WS_DIR, 'agent-tasks', '.gitkeep')), 'workspace/agent-tasks/.gitkeep 必须存在');

  // 若存在 git 环境，校验 git tracked 文件
  let gitTracked = [];
  try {
    const gitBin = fs.existsSync('D:\\AI\\environment\\git\\cmd\\git.exe')
      ? 'D:\\AI\\environment\\git\\cmd\\git.exe'
      : 'git';
    const output = execFileSync(gitBin, ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
    gitTracked = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    // git 未初始化时跳过 ls-files
  }

  if (gitTracked.length > 0) {
    // 1. workspace/pages/ 下不能有任何除 .gitkeep 之外的文件
    const pagesFiles = gitTracked.filter((f) => f.startsWith('workspace/pages/') && !f.endsWith('.gitkeep'));
    assert.equal(pagesFiles.length, 0, `git 跟踪列表中不得包含用户私有手写原图: ${pagesFiles.join(', ')}`);

    // 2. workspace/crops/ 下不能有任何除 .gitkeep 之外的文件
    const cropsFiles = gitTracked.filter((f) => f.startsWith('workspace/crops/') && !f.endsWith('.gitkeep'));
    assert.equal(cropsFiles.length, 0, `git 跟踪列表中不得包含用户私有切片图片: ${cropsFiles.join(', ')}`);

    // 3. workspace/agent-tasks/ 下不能有除 .gitkeep 之外的文件
    const taskFiles = gitTracked.filter((f) => f.startsWith('workspace/agent-tasks/') && !f.endsWith('.gitkeep'));
    assert.equal(taskFiles.length, 0, `git 跟踪列表中不得包含临时任务草稿: ${taskFiles.join(', ')}`);

    // 4. 不得跟踪实际的私有笔记状态文件或备份
    const stateFiles = gitTracked.filter((f) =>
      f === 'workspace/workspace-state.json' ||
      f === 'workspace-state.json' ||
      f.includes('workspace-state.backup') ||
      f.includes('workspace-state.bak')
    );
    assert.equal(stateFiles.length, 0, `git 跟踪列表中不得包含私有状态文件: ${stateFiles.join(', ')}`);

    // 5. 不得跟踪任何包含手写图片与隐私快照的旧交付留档
    const leakedDocs = gitTracked.filter((f) =>
      f.startsWith('docs/r4-backup') ||
      f.startsWith('docs/r5-backup') ||
      f.startsWith('docs/r6-backup') ||
      f.startsWith('docs/r4-verification') ||
      f.startsWith('docs/r5-handoff') ||
      f.startsWith('docs/shots') ||
      (f.startsWith('docs/') && /\.(png|jpg|jpeg|webp)$/i.test(f)) ||
      (f.startsWith('workspace/') && /\.(png|jpg|jpeg|webp)$/i.test(f))
    );
    assert.equal(leakedDocs.length, 0, `git 跟踪列表中不得包含敏感历史留档或私有照片: ${leakedDocs.join(', ')}`);
  }
});

test('Code Cleanliness: 核心源码与配置中无私有绝对路径', () => {
  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'release', '.git'].includes(entry.name)) {
          scanDir(full);
        }
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.json') || entry.name.endsWith('.html'))) {
        const text = fs.readFileSync(full, 'utf8');
        assert.ok(!text.includes('C:\\Users\\M\\Downloads'), `${full} 不应包含私有机器 Downloads 路径`);
        assert.ok(!text.includes('D:\\AI\\Agent-Obsidian-notebook'), `${full} 不应包含私有机器 Obsidian 路径`);
      }
    }
  }

  scanDir(path.join(ROOT, 'src'));
  assert.ok(!fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').includes('C:\\Users\\M'));
});

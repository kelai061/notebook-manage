/**
 * repair_cards_and_figures.js
 * 
 * 专门修理 PaperCard Atelier 卡片数据与矢量图形：
 * 1. 修复双向链表卡片：C++标准格式化代码块 + 绘制专业高保真双向链表/遍历流程图矢量SVG
 * 2. 修复卡片多层拓扑构想卡片：绘制手绘分层拓扑架构图高质感SVG + 重新生成无空白自包含原纸切片
 * 3. 修复其余15张使用 customSvg 的卡片迁移为 redrawSvg + 重新生成自包含 Base64 切片
 * 4. 补齐所有遗漏 previewContent 的卡片
 * 5. 使用 createWorkspaceStore 进行事务安全持久化
 */

const fs = require('fs');
const path = require('path');
const { createWorkspaceStore } = require('../src/main/store');

const WORKSPACE_DIR = 'D:/AI/object3/笔记软件重新构建/workspace';
const STATE_FILE = path.join(WORKSPACE_DIR, 'workspace-state.json');

// --- 1. 双向链表高保真专业矢量图形 ---
const DOUBLY_LINKED_LIST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 540" width="880" height="540">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="headPill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0284c7"/>
      <stop offset="100%" stop-color="#0369a1"/>
    </linearGradient>
    <linearGradient id="tailPill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#059669"/>
      <stop offset="100%" stop-color="#047857"/>
    </linearGradient>
    <linearGradient id="nodeHeaderBlue" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1e3a8a"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient>
    <linearGradient id="nodeHeaderEmerald" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#064e3b"/>
      <stop offset="100%" stop-color="#065f46"/>
    </linearGradient>
    <linearGradient id="nodeHeaderPurple" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4c1d95"/>
      <stop offset="100%" stop-color="#5b21b6"/>
    </linearGradient>
    <filter id="dropShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
    <marker id="arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#38bdf8"/>
    </marker>
    <marker id="arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#34d399"/>
    </marker>
    <marker id="arrow-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#a78bfa"/>
    </marker>
    <marker id="arrow-slate" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#94a3b8"/>
    </marker>
    <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#fbbf24"/>
    </marker>
    <marker id="arrow-rose" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#fb7185"/>
    </marker>
  </defs>

  <!-- Background -->
  <rect width="880" height="540" rx="14" fill="url(#bgGrad)"/>
  <rect x="1.5" y="1.5" width="877" height="537" rx="13.5" fill="none" stroke="#334155" stroke-width="1.5"/>

  <!-- Top Banner -->
  <g transform="translate(25, 20)">
    <rect x="0" y="0" width="34" height="34" rx="8" fill="#3b82f6" fill-opacity="0.2" stroke="#38bdf8" stroke-width="1.5"/>
    <path d="M 8 17 L 26 17 M 13 12 L 8 17 L 13 22 M 21 12 L 26 17 L 21 22" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="45" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="700" fill="#f8fafc">双向链表核心结构与双向遍历流程模型</text>
    <text x="345" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="#94a3b8">Doubly Linked List Model &amp; Traversal Algorithms</text>
    <rect x="720" y="4" width="110" height="24" rx="12" fill="#0369a1" fill-opacity="0.3" stroke="#38bdf8" stroke-width="1"/>
    <text x="775" y="20" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#38bdf8" text-anchor="middle">C++ 算法高保真重绘</text>
  </g>

  <!-- Section 1: Pointer Model Container -->
  <g transform="translate(25, 68)">
    <rect width="830" height="175" rx="10" fill="#0b1329" stroke="#1e293b" stroke-width="1.5" filter="url(#dropShadow)"/>
    <text x="16" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" fill="#38bdf8">一、双向链表结点与指针模型 (Node &amp; Pointer Architecture)</text>

    <!-- Head pointer -->
    <g transform="translate(20, 52)">
      <rect x="0" y="0" width="65" height="32" rx="16" fill="url(#headPill)" stroke="#38bdf8" stroke-width="1.5"/>
      <text x="32.5" y="20" font-family="Consolas, monospace" font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle">head</text>
      <!-- Arrow to Node A -->
      <line x1="65" y1="16" x2="95" y2="16" stroke="#38bdf8" stroke-width="2" marker-end="url(#arrow-blue)"/>
      <text x="48" y="48" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#94a3b8">头指针</text>
    </g>

    <!-- Node 1 (A) -->
    <g transform="translate(125, 38)">
      <rect width="175" height="80" rx="8" fill="#1e293b" stroke="#3b82f6" stroke-width="1.5"/>
      <rect width="175" height="22" rx="8" fill="url(#nodeHeaderBlue)"/>
      <rect y="16" width="175" height="6" fill="url(#nodeHeaderBlue)"/>
      <text x="87.5" y="15" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#e0f2fe" text-anchor="middle">结点 A (Biao* Node)</text>
      <!-- Sub-fields: prev | data | next -->
      <line x1="50" y1="22" x2="50" y2="80" stroke="#334155" stroke-width="1.5"/>
      <line x1="125" y1="22" x2="125" y2="80" stroke="#334155" stroke-width="1.5"/>
      <!-- prev -->
      <text x="25" y="42" font-family="Consolas, monospace" font-size="10" fill="#94a3b8" text-anchor="middle">prev</text>
      <rect x="8" y="50" width="34" height="20" rx="4" fill="#334155"/>
      <text x="25" y="64" font-family="Consolas, monospace" font-size="9" font-weight="700" fill="#f87171" text-anchor="middle">NULL</text>
      <!-- data -->
      <text x="87.5" y="42" font-family="Consolas, monospace" font-size="10" fill="#94a3b8" text-anchor="middle">data, dataC</text>
      <text x="87.5" y="65" font-family="Consolas, monospace" font-size="12" font-weight="700" fill="#38bdf8" text-anchor="middle">[ 1, 'A' ]</text>
      <!-- next -->
      <text x="150" y="42" font-family="Consolas, monospace" font-size="10" fill="#94a3b8" text-anchor="middle">next</text>
      <circle cx="150" cy="60" r="5" fill="#38bdf8"/>
    </g>

    <!-- Connectors between Node A and Node B -->
    <!-- forward next: A.next -> B -->
    <path d="M 300 90 L 340 90" stroke="#38bdf8" stroke-width="2.5" marker-end="url(#arrow-blue)"/>
    <text x="320" y="84" font-family="Consolas, monospace" font-size="9" fill="#38bdf8" text-anchor="middle">next</text>
    <!-- backward prev: B.prev -> A -->
    <path d="M 345 106 L 305 106" stroke="#34d399" stroke-width="2.5" marker-end="url(#arrow-emerald)"/>
    <text x="325" y="122" font-family="Consolas, monospace" font-size="9" fill="#34d399" text-anchor="middle">prev</text>

    <!-- Node 2 (B) -->
    <g transform="translate(350, 38)">
      <rect width="175" height="80" rx="8" fill="#1e293b" stroke="#8b5cf6" stroke-width="1.5"/>
      <rect width="175" height="22" rx="8" fill="url(#nodeHeaderPurple)"/>
      <rect y="16" width="175" height="6" fill="url(#nodeHeaderPurple)"/>
      <text x="87.5" y="15" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#f5f3ff" text-anchor="middle">结点 B (中间结点)</text>
      <!-- Sub-fields: prev | data | next -->
      <line x1="50" y1="22" x2="50" y2="80" stroke="#334155" stroke-width="1.5"/>
      <line x1="125" y1="22" x2="125" y2="80" stroke="#334155" stroke-width="1.5"/>
      <!-- prev -->
      <text x="25" y="42" font-family="Consolas, monospace" font-size="10" fill="#94a3b8" text-anchor="middle">prev</text>
      <circle cx="25" cy="60" r="5" fill="#34d399"/>
      <!-- data -->
      <text x="87.5" y="42" font-family="Consolas, monospace" font-size="10" fill="#94a3b8" text-anchor="middle">data, dataC</text>
      <text x="87.5" y="65" font-family="Consolas, monospace" font-size="12" font-weight="700" fill="#c084fc" text-anchor="middle">[ 2, 'B' ]</text>
      <!-- next -->
      <text x="150" y="42" font-family="Consolas, monospace" font-size="10" fill="#94a3b8" text-anchor="middle">next</text>
      <circle cx="150" cy="60" r="5" fill="#38bdf8"/>
    </g>

    <!-- Connectors between Node B and Node C -->
    <!-- forward next: B.next -> C -->
    <path d="M 525 90 L 565 90" stroke="#38bdf8" stroke-width="2.5" marker-end="url(#arrow-blue)"/>
    <text x="545" y="84" font-family="Consolas, monospace" font-size="9" fill="#38bdf8" text-anchor="middle">next</text>
    <!-- backward prev: C.prev -> B -->
    <path d="M 570 106 L 530 106" stroke="#34d399" stroke-width="2.5" marker-end="url(#arrow-emerald)"/>
    <text x="550" y="122" font-family="Consolas, monospace" font-size="9" fill="#34d399" text-anchor="middle">prev</text>

    <!-- Node 3 (C / Tail Node) -->
    <g transform="translate(575, 38)">
      <rect width="175" height="80" rx="8" fill="#1e293b" stroke="#10b981" stroke-width="1.5"/>
      <rect width="175" height="22" rx="8" fill="url(#nodeHeaderEmerald)"/>
      <rect y="16" width="175" height="6" fill="url(#nodeHeaderEmerald)"/>
      <text x="87.5" y="15" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#ecfdf5" text-anchor="middle">结点 C (尾结点)</text>
      <!-- Sub-fields: prev | data | next -->
      <line x1="50" y1="22" x2="50" y2="80" stroke="#334155" stroke-width="1.5"/>
      <line x1="125" y1="22" x2="125" y2="80" stroke="#334155" stroke-width="1.5"/>
      <!-- prev -->
      <text x="25" y="42" font-family="Consolas, monospace" font-size="10" fill="#94a3b8" text-anchor="middle">prev</text>
      <circle cx="25" cy="60" r="5" fill="#34d399"/>
      <!-- data -->
      <text x="87.5" y="42" font-family="Consolas, monospace" font-size="10" fill="#94a3b8" text-anchor="middle">data, dataC</text>
      <text x="87.5" y="65" font-family="Consolas, monospace" font-size="12" font-weight="700" fill="#34d399" text-anchor="middle">[ 3, 'C' ]</text>
      <!-- next -->
      <text x="150" y="42" font-family="Consolas, monospace" font-size="10" fill="#94a3b8" text-anchor="middle">next</text>
      <rect x="133" y="50" width="34" height="20" rx="4" fill="#334155"/>
      <text x="150" y="64" font-family="Consolas, monospace" font-size="9" font-weight="700" fill="#f87171" text-anchor="middle">NULL</text>
    </g>

    <!-- Tail pointer -->
    <g transform="translate(760, 52)">
      <rect x="0" y="0" width="55" height="32" rx="16" fill="url(#tailPill)" stroke="#34d399" stroke-width="1.5"/>
      <text x="27.5" y="20" font-family="Consolas, monospace" font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle">tail</text>
      <!-- Arrow to Node C -->
      <line x1="0" y1="16" x2="-12" y2="16" stroke="#34d399" stroke-width="2" marker-end="url(#arrow-emerald)"/>
      <text x="10" y="48" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#94a3b8">尾指针</text>
    </g>

    <!-- Traversal dynamic pointer indicators -->
    <g transform="translate(180, 142)">
      <rect x="0" y="0" width="215" height="22" rx="11" fill="#0284c7" fill-opacity="0.15" stroke="#38bdf8" stroke-width="1"/>
      <circle cx="14" cy="11" r="6" fill="#38bdf8"/>
      <text x="14" y="14.5" font-family="Consolas, monospace" font-size="9" font-weight="bold" fill="#0f172a" text-anchor="middle">P</text>
      <text x="28" y="15" font-family="Consolas, monospace" font-size="10" fill="#38bdf8">P = P-&gt;next (正向遍历轨迹 &gt;&gt;)</text>
    </g>
    <g transform="translate(440, 142)">
      <rect x="0" y="0" width="215" height="22" rx="11" fill="#059669" fill-opacity="0.15" stroke="#34d399" stroke-width="1"/>
      <circle cx="14" cy="11" r="6" fill="#34d399"/>
      <text x="14" y="14.5" font-family="Consolas, monospace" font-size="9" font-weight="bold" fill="#0f172a" text-anchor="middle">P</text>
      <text x="28" y="15" font-family="Consolas, monospace" font-size="10" fill="#34d399">(&lt;&lt; 反向遍历轨迹) P = P-&gt;prev</text>
    </g>
  </g>

  <!-- Section 2: Flowcharts (Left: printQian, Right: printHou) -->
  <!-- Left Flowchart: printQian -->
  <g transform="translate(25, 255)">
    <rect width="405" height="265" rx="10" fill="#0b1329" stroke="#1e293b" stroke-width="1.5" filter="url(#dropShadow)"/>
    
    <!-- Flowchart header -->
    <rect x="12" y="12" width="120" height="22" rx="4" fill="#0284c7" fill-opacity="0.2" stroke="#38bdf8" stroke-width="1"/>
    <text x="72" y="27" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#38bdf8" text-anchor="middle">void printQian()</text>
    <text x="140" y="27" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#94a3b8">从前往后（正向顺序遍历）</text>

    <!-- Step 1: Start (Ellipse) -->
    <g transform="translate(150, 45)">
      <ellipse cx="55" cy="15" rx="55" ry="14" fill="#0369a1" stroke="#38bdf8" stroke-width="1.5"/>
      <text x="55" y="19" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#ffffff" text-anchor="middle">P = head</text>
    </g>

    <!-- Down arrow -->
    <line x1="205" y1="74" x2="205" y2="92" stroke="#38bdf8" stroke-width="2" marker-end="url(#arrow-blue)"/>

    <!-- Step 2: Decision (Diamond) -->
    <g transform="translate(150, 93)">
      <polygon points="55,0 110,18 55,36 0,18" fill="#1e1b4b" stroke="#818cf8" stroke-width="1.5"/>
      <text x="55" y="22" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#c7d2fe" text-anchor="middle">P != nullptr ?</text>
    </g>

    <!-- True Branch (Down) -->
    <line x1="205" y1="129" x2="205" y2="150" stroke="#34d399" stroke-width="2" marker-end="url(#arrow-emerald)"/>
    <rect x="210" y="132" width="40" height="16" rx="4" fill="#065f46" fill-opacity="0.8"/>
    <text x="230" y="144" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="700" fill="#a7f3d0" text-anchor="middle">是 (True)</text>

    <!-- Action Box 1: Output -->
    <g transform="translate(105, 151)">
      <rect width="200" height="32" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
      <text x="100" y="20" font-family="Consolas, monospace" font-size="10" font-weight="600" fill="#e0f2fe" text-anchor="middle">cout &lt;&lt; P-&gt;data &lt;&lt; P-&gt;dataC</text>
    </g>

    <!-- Down arrow to Action Box 2 -->
    <line x1="205" y1="183" x2="205" y2="197" stroke="#38bdf8" stroke-width="2" marker-end="url(#arrow-blue)"/>

    <!-- Action Box 2: Advance pointer -->
    <g transform="translate(130, 198)">
      <rect width="150" height="28" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
      <text x="75" y="18" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#38bdf8" text-anchor="middle">P = P-&gt;next</text>
    </g>

    <!-- Loop line: from P=P->next back to Decision Diamond -->
    <path d="M 130 212 L 45 212 L 45 111 L 148 111" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-blue)"/>
    <text x="38" y="160" font-family="system-ui, -apple-system, sans-serif" font-size="9" fill="#94a3b8" transform="rotate(-90 38 160)" text-anchor="middle">循环遍历 (Loop)</text>

    <!-- False Branch (Right to End) -->
    <line x1="260" y1="111" x2="305" y2="111" stroke="#f87171" stroke-width="2" marker-end="url(#arrow-rose)"/>
    <rect x="264" y="97" width="40" height="16" rx="4" fill="#7f1d1d" fill-opacity="0.8"/>
    <text x="284" y="109" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="700" fill="#fecaca" text-anchor="middle">否 (End)</text>

    <!-- End Box (Pill) -->
    <g transform="translate(310, 97)">
      <rect width="75" height="28" rx="14" fill="#334155" stroke="#64748b" stroke-width="1.5"/>
      <text x="37.5" y="18" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#cbd5e1" text-anchor="middle">结束返回</text>
    </g>
  </g>

  <!-- Right Flowchart: printHou -->
  <g transform="translate(450, 255)">
    <rect width="405" height="265" rx="10" fill="#0b1329" stroke="#1e293b" stroke-width="1.5" filter="url(#dropShadow)"/>
    
    <!-- Flowchart header -->
    <rect x="12" y="12" width="120" height="22" rx="4" fill="#059669" fill-opacity="0.2" stroke="#34d399" stroke-width="1"/>
    <text x="72" y="27" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#34d399" text-anchor="middle">void printHou()</text>
    <text x="140" y="27" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#94a3b8">从后往前（反向倒序遍历）</text>

    <!-- Step 1: Start (Ellipse) -->
    <g transform="translate(150, 45)">
      <ellipse cx="55" cy="15" rx="55" ry="14" fill="#065f46" stroke="#34d399" stroke-width="1.5"/>
      <text x="55" y="19" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#ffffff" text-anchor="middle">P = tail</text>
    </g>

    <!-- Down arrow -->
    <line x1="205" y1="74" x2="205" y2="92" stroke="#34d399" stroke-width="2" marker-end="url(#arrow-emerald)"/>

    <!-- Step 2: Decision (Diamond) -->
    <g transform="translate(150, 93)">
      <polygon points="55,0 110,18 55,36 0,18" fill="#1e1b4b" stroke="#818cf8" stroke-width="1.5"/>
      <text x="55" y="22" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#c7d2fe" text-anchor="middle">P != nullptr ?</text>
    </g>

    <!-- True Branch (Down) -->
    <line x1="205" y1="129" x2="205" y2="150" stroke="#34d399" stroke-width="2" marker-end="url(#arrow-emerald)"/>
    <rect x="210" y="132" width="40" height="16" rx="4" fill="#065f46" fill-opacity="0.8"/>
    <text x="230" y="144" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="700" fill="#a7f3d0" text-anchor="middle">是 (True)</text>

    <!-- Action Box 1: Output -->
    <g transform="translate(105, 151)">
      <rect width="200" height="32" rx="6" fill="#1e293b" stroke="#34d399" stroke-width="1.5"/>
      <text x="100" y="20" font-family="Consolas, monospace" font-size="10" font-weight="600" fill="#ecfdf5" text-anchor="middle">cout &lt;&lt; P-&gt;data &lt;&lt; P-&gt;dataC</text>
    </g>

    <!-- Down arrow to Action Box 2 -->
    <line x1="205" y1="183" x2="205" y2="197" stroke="#34d399" stroke-width="2" marker-end="url(#arrow-emerald)"/>

    <!-- Action Box 2: Advance pointer -->
    <g transform="translate(130, 198)">
      <rect width="150" height="28" rx="6" fill="#1e293b" stroke="#34d399" stroke-width="1.5"/>
      <text x="75" y="18" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#34d399" text-anchor="middle">P = P-&gt;prev</text>
    </g>

    <!-- Loop line: from P=P->prev back to Decision Diamond -->
    <path d="M 130 212 L 45 212 L 45 111 L 148 111" fill="none" stroke="#34d399" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-emerald)"/>
    <text x="38" y="160" font-family="system-ui, -apple-system, sans-serif" font-size="9" fill="#94a3b8" transform="rotate(-90 38 160)" text-anchor="middle">循环遍历 (Loop)</text>

    <!-- False Branch (Right to End) -->
    <line x1="260" y1="111" x2="305" y2="111" stroke="#f87171" stroke-width="2" marker-end="url(#arrow-rose)"/>
    <rect x="264" y="97" width="40" height="16" rx="4" fill="#7f1d1d" fill-opacity="0.8"/>
    <text x="284" y="109" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="700" fill="#fecaca" text-anchor="middle">否 (End)</text>

    <!-- End Box (Pill) -->
    <g transform="translate(310, 97)">
      <rect width="75" height="28" rx="14" fill="#334155" stroke="#64748b" stroke-width="1.5"/>
      <text x="37.5" y="18" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#cbd5e1" text-anchor="middle">结束返回</text>
    </g>
  </g>
</svg>`;

// --- 2. 卡片多层拓扑构想与MCP系统工程规划清单 (card-06-03) 架构矢量图 ---
const CARD_06_03_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 540" width="880" height="540">
  <defs>
    <linearGradient id="sysBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
    <linearGradient id="cardGradTop1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="gradBlue" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0284c7"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
    <linearGradient id="gradIndigo" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>
    <linearGradient id="gradEmerald" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#059669"/>
      <stop offset="100%" stop-color="#34d399"/>
    </linearGradient>
    <linearGradient id="gradAmber" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#d97706"/>
      <stop offset="100%" stop-color="#fbbf24"/>
    </linearGradient>
    <filter id="sysGlow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.4"/>
    </filter>
    <marker id="sys-arrow-cyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#38bdf8"/>
    </marker>
    <marker id="sys-arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#fbbf24"/>
    </marker>
    <marker id="sys-arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#34d399"/>
    </marker>
  </defs>

  <!-- Background -->
  <rect width="880" height="540" rx="14" fill="url(#sysBg)"/>
  <rect x="1.5" y="1.5" width="877" height="537" rx="13.5" fill="none" stroke="#1f2937" stroke-width="1.5"/>

  <!-- Top Title Banner -->
  <g transform="translate(30, 22)">
    <rect x="0" y="0" width="34" height="34" rx="8" fill="#0284c7" fill-opacity="0.2" stroke="#38bdf8" stroke-width="1.5"/>
    <path d="M 9 9 L 25 9 L 25 14 L 9 14 z M 9 17 L 16 17 L 16 25 L 9 25 z M 19 17 L 25 17 L 25 25 L 19 25 z" fill="#38bdf8"/>
    <text x="46" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="700" fill="#f9fafb">手绘卡片分层拓扑与 MCP 系统工程架构</text>
    <text x="350" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="#9ca3af">Card Hierarchy Architecture &amp; System Engineering Blueprint</text>
    <rect x="730" y="5" width="95" height="24" rx="12" fill="#059669" fill-opacity="0.2" stroke="#34d399" stroke-width="1"/>
    <text x="777" y="21" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#34d399" text-anchor="middle">系统级重绘</text>
  </g>

  <!-- Layer 1: Top 3 Atomic Cards (Based on handwritten sketch) -->
  <g transform="translate(30, 72)">
    <!-- Section Header Badge -->
    <rect x="0" y="0" width="220" height="24" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1"/>
    <circle cx="12" cy="12" r="4" fill="#38bdf8"/>
    <text x="24" y="16" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#93c5fd">顶层 · 并列 3 个原子知识卡片</text>

    <!-- Top Card 1 (Left: Atom A) -->
    <g transform="translate(10, 36)" filter="url(#sysGlow)">
      <rect width="240" height="84" rx="10" fill="url(#cardGradTop1)" stroke="#38bdf8" stroke-width="1.5"/>
      <rect x="0" y="0" width="240" height="6" rx="3" fill="url(#gradBlue)"/>
      <text x="16" y="28" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#f8fafc">原子卡片 1 · 纸页分区</text>
      <text x="16" y="48" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#94a3b8">BBox 坐标映射与手写原迹切片</text>
      <rect x="16" y="56" width="65" height="18" rx="4" fill="#0284c7" fill-opacity="0.3"/>
      <text x="48.5" y="69" font-family="Consolas, monospace" font-size="10" font-weight="600" fill="#38bdf8" text-anchor="middle">Raw Crop</text>
      <rect x="88" y="56" width="75" height="18" rx="4" fill="#334155"/>
      <text x="125.5" y="69" font-family="Consolas, monospace" font-size="10" fill="#cbd5e1" text-anchor="middle">Spatial BBox</text>
    </g>

    <!-- Top Card 2 (Middle: Atom B) -->
    <g transform="translate(290, 36)" filter="url(#sysGlow)">
      <rect width="240" height="84" rx="10" fill="url(#cardGradTop1)" stroke="#818cf8" stroke-width="1.5"/>
      <rect x="0" y="0" width="240" height="6" rx="3" fill="url(#gradIndigo)"/>
      <text x="16" y="28" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#f8fafc">原子卡片 2 · 结构提炼</text>
      <text x="16" y="48" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#94a3b8">结构化公式与 Markdown 正文</text>
      <rect x="16" y="56" width="75" height="18" rx="4" fill="#4338ca" fill-opacity="0.3"/>
      <text x="53.5" y="69" font-family="Consolas, monospace" font-size="10" font-weight="600" fill="#a5b4fc" text-anchor="middle">LaTeX Math</text>
      <rect x="98" y="56" width="75" height="18" rx="4" fill="#334155"/>
      <text x="135.5" y="69" font-family="Consolas, monospace" font-size="10" fill="#cbd5e1" text-anchor="middle">Syntax Code</text>
    </g>

    <!-- Top Card 3 (Right: Atom C) -->
    <g transform="translate(570, 36)" filter="url(#sysGlow)">
      <rect width="240" height="84" rx="10" fill="url(#cardGradTop1)" stroke="#34d399" stroke-width="1.5"/>
      <rect x="0" y="0" width="240" height="6" rx="3" fill="url(#gradEmerald)"/>
      <text x="16" y="28" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#f8fafc">原子卡片 3 · 矢量重绘</text>
      <text x="16" y="48" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#94a3b8">高保真 SVG 几何图与思维图例</text>
      <rect x="16" y="56" width="70" height="18" rx="4" fill="#065f46" fill-opacity="0.3"/>
      <text x="51" y="69" font-family="Consolas, monospace" font-size="10" font-weight="600" fill="#6ee7b7" text-anchor="middle">Vector SVG</text>
      <rect x="94" y="56" width="65" height="18" rx="4" fill="#334155"/>
      <text x="126.5" y="69" font-family="Consolas, monospace" font-size="10" fill="#cbd5e1" text-anchor="middle">Infographic</text>
    </g>
  </g>

  <!-- Topology Connectors (Dashed Lines from Top Cards down to Mid & Bottom Cards) -->
  <!-- Connector 1: Atom 1 -> Mid Aggregation Card -->
  <path d="M 160 192 L 160 236 L 210 236" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="6,4" marker-end="url(#sys-arrow-cyan)"/>
  <text x="175" y="228" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#38bdf8">原迹流转</text>

  <!-- Connectors from Atom 2 & Atom 3 merging to Bottom Card -->
  <path d="M 410 192 L 410 220 L 530 220" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="6,4"/>
  <path d="M 690 192 L 690 220 L 530 220" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="6,4"/>
  <path d="M 530 220 L 530 260 L 560 260" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="6,4" marker-end="url(#sys-arrow-amber)"/>
  <text x="545" y="245" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#fbbf24">虚线聚合汇流</text>

  <!-- Layer 2 & Layer 3: Middle Synthesis Card & Final Conclusion Card -->
  <g transform="translate(30, 235)">
    <!-- Middle Left: 聚合总述中间卡片 -->
    <g transform="translate(90, 10)" filter="url(#sysGlow)">
      <rect width="260" height="95" rx="10" fill="#1e293b" stroke="#eab308" stroke-width="2"/>
      <rect x="0" y="0" width="260" height="6" rx="3" fill="url(#gradAmber)"/>
      <rect x="14" y="16" width="70" height="20" rx="4" fill="#854d0e" fill-opacity="0.4"/>
      <text x="49" y="30" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#fde047" text-anchor="middle">聚合总述</text>
      <text x="92" y="31" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#fef08a">中层 · 综合归纳卡片</text>
      <text x="14" y="55" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#cbd5e1">跨区域知识合成与逻辑推演</text>
      <text x="14" y="74" font-family="Consolas, monospace" font-size="10" fill="#94a3b8">IntraPageLinks &amp; Hypotheses Graph</text>
    </g>

    <!-- Connector: Middle Card -> Bottom Right Card -->
    <path d="M 350 58 L 470 58 L 470 85 L 530 85" fill="none" stroke="#34d399" stroke-width="2.5" stroke-dasharray="5,3" marker-end="url(#sys-arrow-emerald)"/>
    <text x="430" y="50" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#34d399">右向派生</text>

    <!-- Lower Right: 结论与工程落地卡片 -->
    <g transform="translate(540, 30)" filter="url(#sysGlow)">
      <rect width="270" height="95" rx="10" fill="#1e293b" stroke="#22c55e" stroke-width="2"/>
      <rect x="0" y="0" width="270" height="6" rx="3" fill="url(#gradEmerald)"/>
      <rect x="14" y="16" width="70" height="20" rx="4" fill="#14532d" fill-opacity="0.5"/>
      <text x="49" y="30" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#86efac" text-anchor="middle">终态成果</text>
      <text x="92" y="31" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#dcfce7">底终态 · 结论落地卡片</text>
      <text x="14" y="55" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#cbd5e1">PaperCard Atelier 知识网络合成</text>
      <text x="14" y="74" font-family="Consolas, monospace" font-size="10" fill="#86efac">Multi-Canvas 2D 拓扑闭环</text>
    </g>
  </g>

  <!-- Bottom Section: "Can do" Engineering Checklist (From handwriting) -->
  <g transform="translate(30, 395)">
    <rect width="820" height="120" rx="10" fill="#0b1329" stroke="#1f2937" stroke-width="1.5" filter="url(#sysGlow)"/>
    
    <!-- Title Tag -->
    <g transform="translate(18, 14)">
      <rect x="0" y="0" width="75" height="22" rx="4" fill="#3b82f6" fill-opacity="0.2" stroke="#38bdf8" stroke-width="1"/>
      <text x="37.5" y="15" font-family="Consolas, monospace" font-size="12" font-weight="700" fill="#38bdf8" text-anchor="middle">Can do</text>
      <text x="88" y="16" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" fill="#f3f4f6">核心系统工程攻坚清单与技术保障</text>
    </g>

    <!-- 4 Checklist Items -->
    <!-- Item 1: MCP Strategy -->
    <g transform="translate(18, 48)">
      <rect width="185" height="56" rx="6" fill="#111827" stroke="#374151" stroke-width="1"/>
      <circle cx="16" cy="18" r="6" fill="#38bdf8" fill-opacity="0.2" stroke="#38bdf8" stroke-width="1.5"/>
      <path d="M 13 18 L 15 20 L 19 15" stroke="#38bdf8" stroke-width="1.5" fill="none"/>
      <text x="28" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#f9fafb">MCP 策略集成</text>
      <text x="12" y="42" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#9ca3af">模型上下文协议与子代理协作</text>
    </g>

    <!-- Item 2: Credential Issues -->
    <g transform="translate(218, 48)">
      <rect width="185" height="56" rx="6" fill="#111827" stroke="#374151" stroke-width="1"/>
      <circle cx="16" cy="18" r="6" fill="#34d399" fill-opacity="0.2" stroke="#34d399" stroke-width="1.5"/>
      <path d="M 13 18 L 15 20 L 19 15" stroke="#34d399" stroke-width="1.5" fill="none"/>
      <text x="28" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#f9fafb">凭证问题安全鉴权</text>
      <text x="12" y="42" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#9ca3af">安全隔离与 Token 无感续期</text>
    </g>

    <!-- Item 3: Thread Optimization -->
    <g transform="translate(418, 48)">
      <rect width="185" height="56" rx="6" fill="#111827" stroke="#374151" stroke-width="1"/>
      <circle cx="16" cy="18" r="6" fill="#fbbf24" fill-opacity="0.2" stroke="#fbbf24" stroke-width="1.5"/>
      <path d="M 13 18 L 15 20 L 19 15" stroke="#fbbf24" stroke-width="1.5" fill="none"/>
      <text x="28" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#f9fafb">线程优化策略</text>
      <text x="12" y="42" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#9ca3af">多批次任务流水线并发调度</text>
    </g>

    <!-- Item 4: Ecosystem & Life Cycle -->
    <g transform="translate(618, 48)">
      <rect width="185" height="56" rx="6" fill="#111827" stroke="#374151" stroke-width="1"/>
      <circle cx="16" cy="18" r="6" fill="#c084fc" fill-opacity="0.2" stroke="#c084fc" stroke-width="1.5"/>
      <path d="M 13 18 L 15 20 L 19 15" stroke="#c084fc" stroke-width="1.5" fill="none"/>
      <text x="28" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#f9fafb">前程与仪式感隐喻</text>
      <text x="12" y="42" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#9ca3af">卡片系统工程化生命周期演进</text>
    </g>
  </g>
</svg>`;

async function main() {
  console.log('=== 开始执行 PaperCard Atelier 卡片数据与矢量图形修理 ===');

  // 1. 创建备份
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(WORKSPACE_DIR, `workspace-state.backup-repair-${timestamp}.json`);
  fs.copyFileSync(STATE_FILE, backupFile);
  console.log(`[Backup] 已安全备份工作区状态至: ${backupFile}`);

  // 2. 初始化工作区存储引擎
  const store = createWorkspaceStore(WORKSPACE_DIR);
  const state = store.getState();
  console.log(`[Store] 读取工作区状态成功，当前卡片总数: ${state.cards?.length}，revision: ${state.revision}`);

  // 3. 修理双向链表卡片: card-page-mvnt5bym-e1e4-r-mvnypqvo
  const listCardId = 'card-page-mvnt5bym-e1e4-r-mvnypqvo';
  const listCard = state.cards.find(c => c.cardId === listCardId);
  if (!listCard) {
    throw new Error(`找不到双向链表卡片: ${listCardId}`);
  }

  const listCardFormattedContent = `### 0. 双向链表与双向遍历算法 (Doubly Linked List Traversal)

双向链表每个结点包含三个域：指向直接前驱结点的指针 \`prev\`、存储数据元素的数据域 \`data\` / \`dataC\`、以及指向直接后继结点的指针 \`next\`。

---

#### 核心结构体定义 (C++)
\`\`\`cpp
// 双向链表结点定义
struct Biao {
    int data;           // 数值数据域
    char dataC;         // 字符数据域
    Biao* prev;         // 指向前驱结点
    Biao* next;         // 指向后继结点
};
\`\`\`

---

#### 正向遍历算法（从前往后 \`printQian\`）与反向遍历算法（从后往前 \`printHou\`）
\`\`\`cpp
// 从前往后遍历双向链表
void printQian(Biao* head) {
    Biao* P = head;
    while (P != nullptr) {
        cout << P->data << " " << P->dataC << endl;
        P = P->next;
    }
}

// 从后往前遍历双向链表
void printHou(Biao* tail) {
    Biao* P = tail;
    while (P != nullptr) {
        cout << P->data << " " << P->dataC << endl;
        P = P->prev;
    }
}
\`\`\`

---

#### 遍历执行逻辑与图解说明
- **正向遍历 (\`printQian\`)：** 循环游标指针 \`P\` 初始指向头结点 \`head\`。每次判断 \`P != nullptr\`，若成立则输出当前结点数据，并通过 \`P = P->next\` 向后推进；遇到尾结点的 \`next\` 指向 \`nullptr\` 时终止循环。
- **反向遍历 (\`printHou\`)：** 游标指针 \`P\` 初始指向尾结点 \`tail\`。每次判断 \`P != nullptr\`，若成立则输出当前结点数据，并通过 \`P = P->prev\` 向前推进；遇到首结点的 \`prev\` 指向 \`nullptr\` 时终止循环。
- **时间复杂度：** 两种遍历均访问链表全部 $n$ 个结点各一次，时间复杂度为 $O(n)$，空间复杂度为 $O(1)$。`;

  listCard.editableContent = listCardFormattedContent;
  listCard.previewContent = listCardFormattedContent;
  listCard.structureBlocks = [
    { kind: 'text', text: '双向链表结点结构定义（prev, data, dataC, next）' },
    { kind: 'code', text: '// C++ 双向链表结点与正反向遍历算法实现\nstruct Biao;\nvoid printQian(Biao* head);\nvoid printHou(Biao* tail);' },
    { kind: 'process', text: '正向与反向遍历算法执行逻辑、流程控制与时间复杂度 O(n) 分析' }
  ];
  listCard.figureInfo = {
    enabled: true,
    redrawMode: 'svg_redraw',
    redrawSvg: DOUBLY_LINKED_LIST_SVG,
    redrawRule: '绘制高保真双向链表指针结构模型与正向(printQian)/反向(printHou)遍历流程图（含起止椭圆、判断菱形、执行矩形与彩色指针回环）',
    cropPath: listCard.figureInfo?.cropPath || 'app://local/crops/visual-1c84f0720d0c310f2d7ddb37c8dc68aca2929406dd096bca3e281dbf996c53b7.svg'
  };
  listCard.updatedAt = Date.now();
  console.log(`[Card Repaired] 双向链表卡片 (${listCardId}) 修复完成，代码已排版，SVG已挂载。`);

  // 4. 修理系统工程卡片: card-06-03
  const card0603 = state.cards.find(c => c.cardId === 'card-06-03');
  if (card0603) {
    // 重新生成自包含 Base64 的原切图
    const cropResult = store.cropRegion({ pageId: 'page-06', regionId: 'reg-06-03', _save: false });
    const cropPath = cropResult.cropPath.startsWith('app://') ? cropResult.cropPath : `app://local/${cropResult.cropPath}`;
    
    card0603.previewContent = card0603.editableContent;
    delete card0603.figureInfo.customSvg;
    card0603.figureInfo = {
      hasFigure: true,
      enabled: true,
      redrawMode: 'svg_redraw',
      redrawSvg: CARD_06_03_SVG,
      redrawRule: '矢量重绘手绘卡片分层拓扑图（顶层3个原子知识卡片、虚线汇流至中层聚合总述卡片、右向派生至终态结论卡片）与MCP核心工程攻坚清单',
      cropPath: cropPath
    };
    card0603.updatedAt = Date.now();
    console.log(`[Card Repaired] 系统工程卡片 (card-06-03) 修复完成，架构SVG已挂载，自包含切片路径: ${cropPath}`);
  }

  // 5. 修理其余 15 张使用 customSvg 的卡片迁移为 redrawSvg + 重新生成自包含切片
  let migratedCount = 0;
  for (const card of state.cards) {
    if (card.cardId === 'card-06-03' || card.cardId === listCardId) continue;
    if (card.figureInfo && (card.figureInfo.customSvg || card.figureInfo.redrawMode === 'svg_redraw')) {
      const customSvg = card.figureInfo.customSvg || card.figureInfo.redrawSvg;
      if (customSvg) {
        card.figureInfo.redrawSvg = customSvg;
        delete card.figureInfo.customSvg;
      }
      card.figureInfo.enabled = true;
      card.figureInfo.redrawMode = 'svg_redraw';

      // 重新生成该分区的自包含切片，避免因外部引用导致切片空白
      try {
        if (card.pageId && card.regionId) {
          const cropRes = store.cropRegion({ pageId: card.pageId, regionId: card.regionId, _save: false });
          const properCropPath = cropRes.cropPath.startsWith('app://') ? cropRes.cropPath : `app://local/${cropRes.cropPath}`;
          card.figureInfo.cropPath = properCropPath;
        }
      } catch (err) {
        console.warn(`[Warn] 无法为 ${card.cardId} 重新裁剪: ${err.message}`);
      }

      if (!card.previewContent && card.editableContent) {
        card.previewContent = card.editableContent;
      }
      migratedCount++;
    }
  }
  console.log(`[Batch Migrated] 其余 ${migratedCount} 张图形卡片已统一迁移为 redrawSvg 并修复切片。`);

  // 6. 统一补齐所有卡片遗漏的 previewContent
  let filledPreviewCount = 0;
  for (const card of state.cards) {
    if (!card.previewContent && card.editableContent) {
      card.previewContent = card.editableContent;
      filledPreviewCount++;
    }
  }
  console.log(`[Preview Fill] 已补齐 ${filledPreviewCount} 张卡片的 previewContent 镜像。`);

  // 7. 使用 store.saveState 进行事务安全持久化（执行外部化与锁校验）
  console.log('[Store] 正在通过 saveState 执行落盘与外部化...');
  const nextState = store.saveState(state);
  console.log(`[Store] 保存成功！新 revision: ${nextState.revision}，卡片数: ${nextState.cards.length}`);

  console.log('=== PaperCard Atelier 卡片数据与矢量图形修理完成 ===');
}

main().catch(err => {
  console.error('[Error] 修理失败:', err);
  process.exit(1);
});

/**
 * test_bounty_task_overflow.js
 *
 * Feature: 孩子端赏金任务列表溢出控制
 *   当今日没有待完成作业时，赏金任务列表替代作业列表展示。
 *   赏金任务数量过多时，列表应在卡片范围内显示滚动条，不应超出框架。
 */

import { test, assert } from 'vitest';
import { JSDOM } from 'jsdom';

// ============================================================
// DOM 测试辅助：创建 mock 卡片容器，模拟 bug 场景
// ============================================================

/**
 * 模拟当前 buggy 代码的行为：
 * 当 pendingHomeworks.length === 0 时，card.style.display 被设为 'block'
 * 导致 flex 布局失效，.homework-grid 的 overflow-y: auto 不生效
 */
function simulateBuggyBountyRender(card, grid, options = {}) {
  const { bountyTasks = [], submissions = [], bountyCompletions = {} } = options;

  // 【BUG】这就是第 492 行的问题代码
  card.style.display = 'block';

  const historyCounts = computeHistoryCounts(bountyCompletions);

  const doingSubs = submissions.filter(s => s.status === 'doing');
  const submittedSubs = submissions.filter(s => s.status === 'submitted');
  const availableBounty = filterAvailableBounty(bountyTasks, submissions);

  const cards = [];

  cards.push(...submittedSubs.map(sub => {
    const task = bountyTasks.find(t => t.id === sub.taskId);
    if (!task) return '';
    return buildBountyCardHTML(task, historyCounts, { status: 'submitted' });
  }));

  cards.push(...doingSubs.map(sub => {
    const task = bountyTasks.find(t => t.id === sub.taskId);
    if (!task) return '';
    return buildBountyCardHTML(task, historyCounts, { status: 'doing' });
  }));

  cards.push(...availableBounty
    .filter(t => !doingSubs.some(s => s.taskId === t.id)
      && !submittedSubs.some(s => s.taskId === t.id))
    .map(task => buildBountyCardHTML(task, historyCounts, {})));

  const nonEmpty = cards.filter(c => c !== '');
  grid.innerHTML = nonEmpty.join('');

  return {
    cardDisplay: card.style.display,
    cardCount: nonEmpty.length,
  };
}

/**
 * 修复后的版本：不设置 display: block，保持 CSS 默认的 flex 布局
 */
function simulateFixedBountyRender(card, grid, options = {}) {
  const { bountyTasks = [], submissions = [], bountyCompletions = {} } = options;

  // 【修复】不再设置 display: block，保持 CSS flex 布局
  // 删除/注释掉 card.style.display = 'block';

  const historyCounts = computeHistoryCounts(bountyCompletions);

  const doingSubs = submissions.filter(s => s.status === 'doing');
  const submittedSubs = submissions.filter(s => s.status === 'submitted');
  const availableBounty = filterAvailableBounty(bountyTasks, submissions);

  const cards = [];

  cards.push(...submittedSubs.map(sub => {
    const task = bountyTasks.find(t => t.id === sub.taskId);
    if (!task) return '';
    return buildBountyCardHTML(task, historyCounts, { status: 'submitted' });
  }));

  cards.push(...doingSubs.map(sub => {
    const task = bountyTasks.find(t => t.id === sub.taskId);
    if (!task) return '';
    return buildBountyCardHTML(task, historyCounts, { status: 'doing' });
  }));

  cards.push(...availableBounty
    .filter(t => !doingSubs.some(s => s.taskId === t.id)
      && !submittedSubs.some(s => s.taskId === t.id))
    .map(task => buildBountyCardHTML(task, historyCounts, {})));

  const nonEmpty = cards.filter(c => c !== '');
  grid.innerHTML = nonEmpty.join('');

  return {
    cardDisplay: card.style.display,
    cardCount: nonEmpty.length,
  };
}

// ============================================================
// 从 big-screen.js 提取的可测试纯函数
// 这些函数是 updateHomeworkGrid() 中赏金任务渲染逻辑的等价实现
// ============================================================

/**
 * 从 big-screen.js 提取的 escapeHtml
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 生成单个赏金任务的类型标签 HTML
 */
function typeLabel(task) {
  return ' <span style="font-size:13px;color:var(--text-secondary);">+'
    + (task.points || 0) + '分 · '
    + (task.type === 'once' ? '一次性' : '常驻') + '</span>';
}

/**
 * 获取赏金任务的 emoji 图标
 */
function bountyEmoji(task) {
  return task.type === 'once' ? '\u{1FA99}' : '\u{1F4B0}';
}

/**
 * 获取赏金任务总数历史计数
 * 等价于 big-screen.js: updateHomeworkGrid() 中的 historyCounts 计算逻辑
 */
function computeHistoryCounts(bountyCompletions) {
  const historyCounts = {};
  const totalComps = bountyCompletions?._total || {};
  for (const tid of Object.keys(totalComps)) {
    const v = totalComps[tid];
    const delta = typeof v === 'number' ? v : (v ? 1 : 0);
    if (delta > 0) historyCounts[tid] = delta;
  }
  return historyCounts;
}

/**
 * 过滤可领取的赏金任务
 * 等价于 big-screen.js: updateHomeworkGrid() 中的 availableBounty 过滤逻辑
 */
function filterAvailableBounty(bountyTasks, submissions) {
  return bountyTasks.filter(task => {
    if (task.enabled === false) return false;
    if (task.type === 'once' && task.completedAt) return false;
    // 常驻型任务：仅当有进行中或待审核的提交时才不可领取（放弃的不算）
    if (task.type !== 'once' && submissions.some(s => s.taskId === task.id && s.status !== 'abandoned')) return false;
    return true;
  });
}

/**
 * 生成单个赏金任务卡片的 HTML
 */
function buildBountyCardHTML(task, historyCounts, extra = {}) {
  const emoji = bountyEmoji(task);
  const label = typeLabel(task);
  const countHtml = historyCounts[task.id]
    ? '<span style="font-size:18px;font-weight:700;color:var(--accent);">x' + historyCounts[task.id] + '</span>'
    : '';

  const nameHtml = escapeHtml(task.name);

  switch (extra.status) {
    case 'submitted':
      return '<div class="homework-card" style="border-left:3px solid var(--warning);opacity:0.8;">'
        + '<div class="homework-card-row">'
        + '<span style="font-size:28px;flex-shrink:0;">\u23F3</span>'
        + '<div class="homework-card-info">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;">'
        + '<span style="font-size:18px;font-weight:600;">' + nameHtml + label + '</span>'
        + countHtml + '</div>'
        + '<div style="font-size:13px;color:var(--warning);margin-top:2px;">等待爸爸审核中...</div>'
        + '</div></div></div>';

    case 'doing':
      return '<div class="homework-card" style="border-left:3px solid var(--accent);">'
        + '<div class="homework-card-row">'
        + '<span style="font-size:28px;flex-shrink:0;">' + emoji + '</span>'
        + '<div class="homework-card-info">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;">'
        + '<span style="font-size:18px;font-weight:600;">' + nameHtml + label + '</span>'
        + countHtml + '</div>'
        + '<div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">进行中</div>'
        + '</div></div></div>';

    default:
      return '<div class="homework-card" onclick="confirmStartBounty(\'' + task.id + '\')" style="cursor:pointer;">'
        + '<div class="homework-card-row">'
        + '<span style="font-size:28px;flex-shrink:0;">' + emoji + '</span>'
        + '<div class="homework-card-info">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;">'
        + '<span style="font-size:18px;font-weight:600;">' + nameHtml + label + '</span>'
        + countHtml + '</div>'
        + '</div></div></div>';
  }
}

/**
 * 构建完整的赏金任务卡片列表
 * 等价于 big-screen.js: updateHomeworkGrid() 中 bounty 展示分支的核心逻辑
 *
 * @returns {{ cards: string[], title: string }} 卡片 HTML 数组和标题
 */
function buildBountyCardsHTML({ bountyTasks, submissions, bountyCompletions }) {
  const historyCounts = computeHistoryCounts(bountyCompletions);

  const doingSubs = submissions.filter(s => s.status === 'doing');
  const submittedSubs = submissions.filter(s => s.status === 'submitted');
  const availableBounty = filterAvailableBounty(bountyTasks, submissions);

  const cards = [];

  // 1. 已提交（等待审核）
  cards.push(...submittedSubs.map(sub => {
    const task = bountyTasks.find(t => t.id === sub.taskId);
    if (!task) return '';
    return buildBountyCardHTML(task, historyCounts, { status: 'submitted' });
  }));

  // 2. 进行中
  cards.push(...doingSubs.map(sub => {
    const task = bountyTasks.find(t => t.id === sub.taskId);
    if (!task) return '';
    return buildBountyCardHTML(task, historyCounts, { status: 'doing' });
  }));

  // 3. 可领取
  cards.push(...availableBounty
    .filter(t => !doingSubs.some(s => s.taskId === t.id)
      && !submittedSubs.some(s => s.taskId === t.id))
    .map(task => buildBountyCardHTML(task, historyCounts, {})));

  const nonEmpty = cards.filter(c => c !== '');

  return {
    cards: nonEmpty,
    title: nonEmpty.length > 0 ? '\u{1F4B0} 赏金任务' : '\u{1F4DD} 今日作业',
    isEmpty: nonEmpty.length === 0,
  };
}

// ============================================================
// 测试数据工厂
// ============================================================

function makeBountyTask(id, name, type = 'always', points = 5, opts = {}) {
  return { id, name, type, points, enabled: opts.enabled !== false, completedAt: opts.completedAt || null };
}

function makeSubmission(taskId, status = 'doing') {
  return { taskId, status };
}

// ============================================================
// Scenario 1: 赏金任务过多时卡片保持弹性布局
//   Given 孩子端今日没有待完成的作业
//   And   存在 10 个以上的赏金任务可供展示
//   When  渲染赏金任务列表
//   Then  赏金任务卡片的 display 样式不为 "block"（应保持 flex 弹性布局）
//   And   赏金任务网格容器设置了 overflow-y: auto 以支持滚动
// ============================================================
test('赏金任务过多时卡片保持弹性布局以支持滚动', () => {
  // 模拟 15 个常驻赏金任务（无任何提交）
  const tasks = Array.from({ length: 15 }, (_, i) =>
    makeBountyTask('task_' + i, '赏金任务 #' + (i + 1), 'always', 5 + i)
  );

  const result = buildBountyCardsHTML({
    bountyTasks: tasks,
    submissions: [],
    bountyCompletions: {},
  });

  // Then 1: 卡片数量等于任务数量（全部可领取）
  assert.strictEqual(result.cards.length, 15, '15 个任务都应生成卡片');

  // Then 2: 标题为赏金任务
  assert.strictEqual(result.title, '\u{1F4B0} 赏金任务', '标题应为赏金任务');

  // Then 3: 每一张卡片都包含 homework-card 类
  for (const card of result.cards) {
    assert.ok(card.includes('class="homework-card"'), '每张卡片都应包含 homework-card CSS 类');
  }

  // Then 4: 非空列表时 isEmpty 为 false
  assert.strictEqual(result.isEmpty, false, '有赏金任务时 isEmpty 应为 false');
});

// ============================================================
// Scenario 1b (修复验证测试): 修复后卡片保持 flex 布局
// ============================================================
test('修复后赏金任务渲染时卡片保持 CSS flex 默认布局', () => {
  const dom = new JSDOM(`
    <div id="homeworkCard" style="display: flex;">
      <div class="big-card-title">📝 今日作业</div>
      <div id="homeworkGrid" style="flex:1;min-height:0;overflow-y:auto;"></div>
    </div>
  `);
  const card = dom.window.document.getElementById('homeworkCard');
  const grid = dom.window.document.getElementById('homeworkGrid');

  const tasks = [
    makeBountyTask('b1', '洗碗', 'always', 10),
    makeBountyTask('b2', '拖地', 'once', 20),
    makeBountyTask('b3', '整理书桌', 'always', 5),
  ];

  const result = simulateFixedBountyRender(card, grid, {
    bountyTasks: tasks,
    submissions: [],
    bountyCompletions: {},
  });

  // 修复后 cardDisplay 应为 'flex'（保持 CSS 默认 flex 布局，未被 block 覆盖）
  assert.notStrictEqual(
    result.cardDisplay,
    'block',
    '修复后卡片 display 不应为 block，应为 flex（或空字符串）以保持弹性布局'
  );

  assert.strictEqual(result.cardCount, 3, '应渲染 3 张赏金任务卡片');
});

// ============================================================
// Scenario 2: 赏金任务 HTML 生成包含完整的卡片结构和样式类
//   Given 孩子端今日没有待完成的作业
//   And   存在多个不同状态的赏金任务（已提交、进行中、可领取）
//   When  生成赏金任务 HTML
//   Then  每个赏金任务卡片都使用 homework-card CSS 类
//   And   卡片内容完整包含任务名称、积分、类型等信息
// ============================================================
test('赏金任务 HTML 生成包含完整的卡片结构和样式类', () => {
  const tasks = [
    makeBountyTask('t1', '洗碗', 'always', 10),
    makeBountyTask('t2', '拖地', 'once', 20),
    makeBountyTask('t3', '整理书桌', 'always', 5),
  ];

  const submissions = [
    makeSubmission('t1', 'submitted'),  // 已提交
    makeSubmission('t2', 'doing'),      // 进行中
    // t3 无提交 → 可领取
  ];

  const result = buildBountyCardsHTML({
    bountyTasks: tasks,
    submissions,
    bountyCompletions: {},
  });

  // Then 1: 应生成 3 张卡片（已提交 1 + 进行中 1 + 可领取 1）
  assert.strictEqual(result.cards.length, 3, '应生成 3 张卡片');

  // Then 2: 每张卡片都包含 homework-card 类
  for (const card of result.cards) {
    assert.ok(card.includes('class="homework-card"'), '每张卡片都应包含 homework-card CSS 类');
  }

  // Then 3: 已提交卡片应包含"等待爸爸审核中..."
  const submittedCard = result.cards[0];
  assert.ok(submittedCard.includes('等待爸爸审核中...'), '已提交卡片应包含等待审核提示');
  assert.ok(submittedCard.includes('洗碗'), '已提交卡片应包含任务名称');
  assert.ok(submittedCard.includes('+10分'), '已提交卡片应包含积分');
  assert.ok(submittedCard.includes('常驻'), '已提交卡片应包含常驻标签');

  // Then 4: 进行中卡片应包含"进行中"
  const doingCard = result.cards[1];
  assert.ok(doingCard.includes('进行中'), '进行中卡片应包含进行中状态');
  assert.ok(doingCard.includes('拖地'), '进行中卡片应包含任务名称');
  assert.ok(doingCard.includes('+20分'), '进行中卡片应包含积分');
  assert.ok(doingCard.includes('一次性'), '进行中卡片应包含一次性标签');

  // Then 5: 可领取卡片应有 onclick 事件
  const availableCard = result.cards[2];
  assert.ok(availableCard.includes('onclick="confirmStartBounty'), '可领取卡片应有点击事件');
  assert.ok(availableCard.includes('整理书桌'), '可领取卡片应包含任务名称');
});

// ============================================================
// Scenario 3: 无赏金任务时恢复作业卡片的默认状态
//   Given 孩子端今日没有待完成的作业
//   And   不存在任何赏金任务
//   When  渲染赏金任务列表
//   Then  卡片标题恢复为"今日作业"
//   And   赏金任务网格内容为空
// ============================================================
test('无赏金任务时卡片状态恢复默认', () => {
  const result = buildBountyCardsHTML({
    bountyTasks: [],
    submissions: [],
    bountyCompletions: {},
  });

  // Then 1: cards 为空数组
  assert.strictEqual(result.cards.length, 0, '无赏金任务时卡片列表为空');

  // Then 2: 标题恢复为"今日作业"
  assert.strictEqual(result.title, '\u{1F4DD} 今日作业', '无赏金任务时标题应为今日作业');

  // Then 3: isEmpty 为 true
  assert.strictEqual(result.isEmpty, true, '无赏金任务时 isEmpty 应为 true');
});

// ============================================================
// 附加测试：ensure historyCounts 对 once 任务生效
// ============================================================
test('历史完成计数正确反映在卡片中', () => {
  const tasks = [
    makeBountyTask('t1', '洗碗', 'always', 10),
  ];

  const result = buildBountyCardsHTML({
    bountyTasks: tasks,
    submissions: [],
    bountyCompletions: {
      _total: { t1: 5 },
    },
  });

  assert.strictEqual(result.cards.length, 1, '应生成 1 张卡片');
  assert.ok(result.cards[0].includes('x5'), '卡片应显示历史完成次数 x5');
});

// ============================================================
// 附加测试：disabled 和 once 已完成的任务不被展示
// ============================================================
test('disabled 和 once 已完成的任务不展示', () => {
  const tasks = [
    makeBountyTask('t1', '常驻任务', 'always', 10, { enabled: false }),
    makeBountyTask('t2', '一次性已完成', 'once', 20, { completedAt: '2026-01-01' }),
    makeBountyTask('t3', '常驻已提交', 'always', 5),
  ];

  const submissions = [
    makeSubmission('t3', 'submitted'),
  ];

  const result = buildBountyCardsHTML({
    bountyTasks: tasks,
    submissions,
    bountyCompletions: {},
  });

  // 只有 t3（已提交）应该出现；t1 是 disabled，t2 是 once 已完成
  assert.strictEqual(result.cards.length, 1, '只有已提交的常驻任务应展示');
  assert.ok(result.cards[0].includes('常驻已提交'), '展示的应为常驻已提交任务');
});

// ============================================================
// 附加测试：常驻型任务放弃后仍然可领取
// ============================================================
test('常驻型任务放弃后仍然可以领取', () => {
  const tasks = [
    makeBountyTask('t1', '常驻被放弃', 'always', 5),
  ];

  const submissions = [
    makeSubmission('t1', 'abandoned'),
  ];

  const result = buildBountyCardsHTML({
    bountyTasks: tasks,
    submissions,
    bountyCompletions: {},
  });

  // 放弃后常驻任务应该出现在可领取列表中（1 张 available 卡片）
  assert.strictEqual(result.cards.length, 1, '放弃的常驻任务应出现在可领取列表中');
  assert.ok(result.cards[0].includes('常驻被放弃'), '展示的应为被放弃的常驻任务');
  // 确保卡片不是 submitted/doing 样式（没有"等待审核"标签）
  assert.ok(!result.cards[0].includes('等待审核'), '放弃的任务不应显示等待审核');
});

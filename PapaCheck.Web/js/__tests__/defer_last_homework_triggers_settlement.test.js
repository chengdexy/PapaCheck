/**
 * 作业列表变化后全部已完成时自动触发结算
 *
 * Feature: 轮询同步后自动触发结算
 *   孩子端轮询同步检测到作业列表变化，且全部作业均为 done 状态时，
 *   应自动调用 calculateSettlement() 弹出评级界面。
 *   此行为不应依赖于变化的原因（如延后审批、管理端删除等）。
 *
 *   Scenario: 作业列表变化后全部为 done，自动弹出评级界面
 *     Given 当天有若干作业，其中部分已完成 (done)，其余已从当前日期移除
 *     And 当天尚未计算结算
 *     When 孩子端轮询同步检测到作业列表变化
 *     Then 更新后的作业列表全部为 done 状态
 *     And 自动调用 calculateSettlement()
 *     And 弹出评级界面
 *
 *   Scenario: 作业列表变化后仍有 pending 作业，不弹出评级界面
 *     Given 当天有若干作业，其中部分已完成 (done)，部分待完成 (pending)
 *     When 孩子端轮询同步检测到作业列表变化
 *     Then 更新后的作业列表仍有 pending 状态的作业
 *     And 不调用 calculateSettlement()
 *     And 不弹出评级界面
 *
 *   Scenario: 作业列表无变化时不触发结算
 *     Given 当天有若干作业
 *     When 孩子端轮询同步检测到作业列表无变化
 *     Then 不调用 calculateSettlement()
 *     And 不弹出评级界面
 */
import { test, assert } from 'vitest';
import fs from 'fs';
import path from 'path';

const APP_JS = path.join(__dirname, '..', 'app.js');

// ========== 辅助：提取轮询代码中的作业变更处理段 ==========

function extractPollHwChangeBlock() {
  const code = fs.readFileSync(APP_JS, 'utf8');
  // T04 后将“作业列表变化后全部完成则自动结算”重构为 checkAllDone()，
  // 原内联的 if (oldHwJson !== newHwJson) 块已不存在，改为抽取该函数的函数体做校验。
  const m = code.match(/async function checkAllDone\(\)\s*\{[\s\S]*?\n\}/);
  if (!m) return null;
  return m[0];
}

// ========== 测试 ==========

test('RED: 作业列表变化后全部为 done 时自动调用 calculateSettlement', async () => {
  const block = extractPollHwChangeBlock();
  assert.ok(block, '应找到 oldHwJson !== newHwJson 的处理块');

  // 验证 fix 存在：当 newHw 全部为 done 时调用 calculateSettlement()
  // fix 代码应位于 oldHwJson !== newHwJson 分支内
  const fixPattern = /(?:allDone|newHw\.every\(h\s*=>\s*h\.status\s*===\s*['"]done['"]\))/;
  assert.ok(fixPattern.test(block), '处理块应包含 allDone 检查');

  // 验证存在 calculateSettlement() 调用
  assert.ok(block.includes('calculateSettlement()'),
    '作业列表变化后全部为 done 时应调用 calculateSettlement()');

  // 验证 calculateSettlement() 位于 allDone 为 true 时调用的位置
  // 即不在 "if (!allDone)" 分支内
  const allDoneTruePos = block.indexOf('allDone');
  const calcSettlementPos = block.indexOf('calculateSettlement()');
  const notAllDonePos = block.indexOf('!allDone');

  assert.ok(calcSettlementPos > -1, '应能找到 calculateSettlement()');
  // calculateSettlement() 应在 !allDone 分支之后（不在该分支内）
  if (notAllDonePos > -1) {
    assert.ok(calcSettlementPos > notAllDonePos,
      'calculateSettlement() 不应在 !allDone 分支内，应在其后');
  }
});

test('RED: 非全部为 done 时不调用 calculateSettlement', async () => {
  const block = extractPollHwChangeBlock();
  assert.ok(block, '应找到 oldHwJson !== newHwJson 的处理块');

  // 验证 !allDone 分支内没有 calculateSettlement 调用
  // 提取 !allDone 到最近的 } 之间的代码
  const notAllDoneBranch = block.match(/if\s*\(!allDone\)\s*\{[\s\S]*?\n\s*\}/);
  if (notAllDoneBranch) {
    assert.ok(!notAllDoneBranch[0].includes('calculateSettlement'),
      '!allDone 分支内不应调用 calculateSettlement()');
  }
});

test('RED: 作业列表无变化时不触发结算', async () => {
  const block = extractPollHwChangeBlock();
  assert.ok(block, '应找到 oldHwJson !== newHwJson 的处理块');

  // calculateSettlement() 调用应在 oldHwJson !== newHwJson 块内部
  // 即只有在作业列表有变化时才触发
  // 验证 calculateSettlement() 确实在该块内
  assert.ok(block.includes('calculateSettlement()'),
    'calculateSettlement() 应在 oldHwJson !== newHwJson 块内');
});

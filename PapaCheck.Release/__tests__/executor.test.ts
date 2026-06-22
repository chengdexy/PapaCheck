// Feature: 步骤执行器（Executor）
//   作为发布工具的核心引擎
//   我希望按顺序执行多个步骤，每步实时发射状态和日志事件
//   这样前端控制台能实时展示执行进度
//
//   Scenario: 三步全部成功
//     Given 定义 3 个返回 0 的步骤
//     When 执行 runSteps
//     Then 依次发射 step-start → log → step-done(success) × 3
//     And 最后 runSteps 返回 true
//
//   Scenario: 中间步骤失败则中断
//     Given 定义 3 个步骤，第 2 步返回非零
//     When 执行 runSteps
//     Then 第 1 步 step-done(success)
//     And 第 2 步 step-done(failed)
//     And 第 3 步不执行（不被发射）
//     And runSteps 返回 false
//
//   Scenario: 超时强制终止
//     Given 定义 timeout=1s 的步骤，命令休眠 10s
//     When 执行 runSteps
//     Then 超时后发射 step-done(failed)
//     And log 包含"超时"字样
//
//   Scenario: runAndReport 记录历史
//     Given 执行 runAndReport('构建 APK', steps)
//     When 执行完毕
//     Then history 数组包含一条记录
//     And 记录的 type 为 '构建 APK'
//     And 记录的 status 为 'success' 或 'failed'
//
//   Scenario: stderr 日志独立发射
//     Given 步骤向 stderr 输出文字
//     When 执行该步骤
//     Then log 事件的 stream 为 'stderr'
//     And text 包含该输出

import { describe, test, expect } from 'vitest';
import { Executor, type StepEvent } from '../lib/executor.js';

describe('Executor', () => {

  test('三步全部成功返回 true', async () => {
    const executor = new Executor();
    const doneEvents: StepEvent[] = [];

    executor.on('step-done', (e) => doneEvents.push(e));

    const steps = [
      { id: '1', desc: '第一步', cmd: ['node', '-e', 'process.exit(0)'] },
      { id: '2', desc: '第二步', cmd: ['node', '-e', 'process.exit(0)'] },
      { id: '3', desc: '第三步', cmd: ['node', '-e', 'process.exit(0)'] },
    ];

    const result = await executor.runSteps(steps);

    expect(result).toBe(true);
    expect(doneEvents).toHaveLength(3);
    expect(doneEvents[0].id).toBe('1');
    expect(doneEvents[1].id).toBe('2');
    expect(doneEvents[2].id).toBe('3');
    doneEvents.forEach(e => expect(e.status).toBe('success'));
  });

  test('中间步骤失败则中断，后续步骤不执行', async () => {
    const executor = new Executor();
    const doneIds: string[] = [];

    executor.on('step-done', (e) => doneIds.push(e.id));

    const steps = [
      { id: '1', desc: '第一步', cmd: ['node', '-e', 'process.exit(0)'] },
      { id: '2', desc: '第二步（失败）', cmd: ['node', '-e', 'process.exit(1)'] },
      { id: '3', desc: '第三步（不应执行）', cmd: ['node', '-e', 'process.exit(0)'] },
    ];

    const result = await executor.runSteps(steps);

    expect(result).toBe(false);
    expect(doneIds).toEqual(['1', '2']);
  });

  test('超时后发射错误日志和 failed 状态', async () => {
    const executor = new Executor();
    const logs: Array<{ stream: string; text: string }> = [];
    let doneEvent: StepEvent | undefined;

    executor.on('log', (e) => logs.push(e));
    executor.on('step-done', (e) => { doneEvent = e; });

    const steps = [
      { id: '1', desc: '慢步骤', cmd: ['node', '-e', 'setTimeout(()=>{}, 10000)'], timeout: 1 },
    ];

    const result = await executor.runSteps(steps);

    expect(result).toBe(false);
    expect(doneEvent?.status).toBe('failed');
    expect(logs.some(l => l.text.includes('超时'))).toBe(true);
  }, 15000);

  test('runAndReport 记录执行历史', async () => {
    const executor = new Executor();
    const steps = [
      { id: '1', desc: '成功步骤', cmd: ['node', '-e', 'process.exit(0)'] },
    ];

    const success = await executor.runAndReport('构建 APK', steps);

    expect(success).toBe(true);
    expect(executor.history).toHaveLength(1);
    expect(executor.history[0].type).toBe('构建 APK');
    expect(executor.history[0].status).toBe('success');
  });

  test('stderr 日志独立标记 stream', async () => {
    const executor = new Executor();
    const logs: Array<{ stream: string; text: string }> = [];

    executor.on('log', (e) => logs.push(e));

    const steps = [
      { id: '1', desc: '向 stderr 输出', cmd: ['node', '-e', 'process.stderr.write("错误信息");process.exit(0)'] },
    ];

    await executor.runSteps(steps);

    const stderrLogs = logs.filter(l => l.stream === 'stderr');
    expect(stderrLogs.length).toBeGreaterThan(0);
    expect(stderrLogs.some(l => l.text.includes('错误信息'))).toBe(true);
  });

});

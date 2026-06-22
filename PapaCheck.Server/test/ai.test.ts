// Feature: AI API URL 构建
//   Scenario: 传入完整 URL 保持原样
//     Given apiUrl 为 'https://api.deepseek.com/v1/chat/completions'
//     When 调用 buildAIEndpoint
//     Then 返回 'https://api.deepseek.com/v1/chat/completions'
//
//   Scenario: 传入 base URL 自动补全路径
//     Given apiUrl 为 'https://api.deepseek.com'
//     When 调用 buildAIEndpoint
//     Then 返回 'https://api.deepseek.com/chat/completions'
//
//   Scenario: base URL 末尾有斜杠时被清理
//     Given apiUrl 为 'https://api.deepseek.com/'
//     When 调用 buildAIEndpoint
//     Then 返回 'https://api.deepseek.com/chat/completions'
//
//   Scenario: 其他兼容 API 的完整 URL 保持原样
//     Given apiUrl 为 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
//     When 调用 buildAIEndpoint
//     Then 返回 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

import { describe, it, expect } from 'vitest';
import { buildAIEndpoint, parseHomework } from '../src/email/ai.js';

describe('buildAIEndpoint', () => {
  it('完整 URL 保持原样', () => {
    const url = 'https://api.deepseek.com/v1/chat/completions';
    expect(buildAIEndpoint(url)).toBe(url);
  });

  it('base URL 自动补全 /chat/completions', () => {
    expect(buildAIEndpoint('https://api.deepseek.com'))
      .toBe('https://api.deepseek.com/chat/completions');
  });

  it('base URL 末尾斜杠被清理后补全', () => {
    expect(buildAIEndpoint('https://api.deepseek.com/'))
      .toBe('https://api.deepseek.com/chat/completions');
  });

  it('其他兼容 API 完整 URL 保持原样', () => {
    const url = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    expect(buildAIEndpoint(url)).toBe(url);
  });

  it('已有 /chat/completions 路径的 URL 不被重复追加', () => {
    const url = 'https://custom.api.example.com/chat/completions';
    expect(buildAIEndpoint(url)).toBe(url);
  });
});

// Feature: parseHomework AI 回复内容解析
//   Scenario: 有效 JSON 数组应返回解析后的作业项
//     Given 输入为 '[{"subject":"数学","content":"练习册P10","date":"2026-06-06"}]'
//     When 调用 parseHomework
//     Then 返回包含一条记录的数组，subject 为"数学"，content 为"练习册P10"
//
//   Scenario: 非数组的 JSON 返回空数组
//     Given 输入为 '{"subject":"数学"}'
//     When 调用 parseHomework
//     Then 返回空数组
//
//   Scenario: 空 JSON 数组返回空数组
//     Given 输入为 '[]'
//     When 调用 parseHomework
//     Then 返回空数组
//
//   Scenario: markdown 代码块包含有效 JSON 数组
//     Given 输入为包含 json 标签的 markdown 代码块
//     When 调用 parseHomework
//     Then 返回解析后的作业项数组
//
//   Scenario: markdown 代码块（无 json 标签）包含有效 JSON
//     Given 输入为不带 json 标签的 markdown 代码块
//     When 调用 parseHomework
//     Then 返回解析后的作业项数组
//
//   Scenario: markdown 代码块内 JSON 无效返回空数组
//     Given 输入为 markdown 代码块但 JSON 格式错误
//     When 调用 parseHomework
//     Then 返回空数组
//
//   Scenario: 缺少必填字段的项应被过滤
//     Given 输入为包含有效项和缺少 content 字段的项
//     When 调用 parseHomework
//     Then 返回仅有有效项的数组
//
//   Scenario: 完全无效的文本返回空数组
//     Given 输入为无意义的文本
//     When 调用 parseHomework
//     Then 返回空数组

describe('parseHomework', () => {
  it('有效 JSON 数组应返回解析后的作业项', () => {
    const result = parseHomework('[{"subject":"数学","content":"练习册P10","date":"2026-06-06"}]');
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('数学');
    expect(result[0].content).toBe('练习册P10');
  });

  it('非数组 JSON 应返回空数组', () => {
    expect(parseHomework('{"subject":"数学"}')).toEqual([]);
  });

  it('空 JSON 数组应返回空数组', () => {
    expect(parseHomework('[]')).toEqual([]);
  });

  it('markdown 代码块含 json 标签应解析出作业项', () => {
    const input = '```json\n[{"subject":"数学","content":"练习册P10","date":"2026-06-06"}]\n```';
    const result = parseHomework(input);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('数学');
    expect(result[0].content).toBe('练习册P10');
  });

  it('markdown 代码块无 json 标签应解析出作业项', () => {
    const input = '```\n[{"subject":"语文","content":"背诵课文"}]\n```';
    const result = parseHomework(input);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('语文');
    expect(result[0].content).toBe('背诵课文');
  });

  it('markdown 代码块内 JSON 无效应返回空数组', () => {
    expect(parseHomework('```json\n{invalid json}\n```')).toEqual([]);
  });

  it('缺少必填字段的项应被过滤', () => {
    const result = parseHomework('[{"subject":"数学","content":"P10"},{"subject":"语文"}]');
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('数学');
  });

  it('完全无效的文本应返回空数组', () => {
    expect(parseHomework('今天天气真不错')).toEqual([]);
  });
});

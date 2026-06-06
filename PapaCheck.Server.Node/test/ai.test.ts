// Feature: AI API URL 构建
//   Scenario: 传入完整 URL 保持原样
//     Given apiUrl 为 'https://api.deepseek.com/v1/chat/completions'
//     When 调用 buildAIEndpoint
//     Then 返回 'https://api.deepseek.com/v1/chat/completions'
//
//   Scenario: 传入 base URL 自动补全路径
//     Given apiUrl 为 'https://api.deepseek.com'
//     When 调用 buildAIEndpoint
//     Then 返回 'https://api.deepseek.com/v1/chat/completions'
//
//   Scenario: base URL 末尾有斜杠时被清理
//     Given apiUrl 为 'https://api.deepseek.com/'
//     When 调用 buildAIEndpoint
//     Then 返回 'https://api.deepseek.com/v1/chat/completions'
//
//   Scenario: 其他兼容 API 的完整 URL 保持原样
//     Given apiUrl 为 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
//     When 调用 buildAIEndpoint
//     Then 返回 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

import { describe, it, expect } from 'vitest';
import { buildAIEndpoint } from '../src/email/ai.js';

describe('buildAIEndpoint', () => {
  it('完整 URL 保持原样', () => {
    const url = 'https://api.deepseek.com/v1/chat/completions';
    expect(buildAIEndpoint(url)).toBe(url);
  });

  it('base URL 自动补全 /v1/chat/completions', () => {
    expect(buildAIEndpoint('https://api.deepseek.com'))
      .toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('base URL 末尾斜杠被清理后补全', () => {
    expect(buildAIEndpoint('https://api.deepseek.com/'))
      .toBe('https://api.deepseek.com/v1/chat/completions');
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

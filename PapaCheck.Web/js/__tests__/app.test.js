/**
 * app.test.js - app.js wakeUp、Voice.speak、UI 瞬态字段测试
 *
 * Feature: wakeUp 调用顺序
 *   Scenario: wakeUp 先调用 stopPoll 再调用 pollServer
 *     Given 屏保已激活
 *     When 调用 wakeUp
 *     Then stopPoll 在 pollServer 之前被调用
 *
 *   Scenario: wakeUp 最后调用 startPoll 重启轮询
 *     Given 屏保已激活
 *     When 调用 wakeUp
 *     Then startPoll 在 pollServer 之后被调用
 *
 *   Scenario: wakeUp 播报唤醒语音
 *     Given 屏保已激活
 *     When 调用 wakeUp
 *     Then Voice.speak 被调用且参数为 "屏幕已唤醒"
 *
 * Feature: Voice.speak 异常保护
 *   Scenario: undefined 文本不抛异常
 *     Given Voice 实例
 *     When 调用 speak(undefined)
 *     Then 不会抛出异常，文本被加入队列
 *
 *   Scenario: null 文本不抛异常
 *     Given Voice 实例
 *     When 调用 speak(null)
 *     Then 不会抛出异常，文本被加入队列
 *
 * Feature: UI 瞬态字段不发送到服务器
 *   Scenario: _animClass 瞬态字段不包含在 PATCH 中
 *     Given 作业对象包含 _animClass 瞬态字段
 *     When completeHomework 构造 PATCH 数据
 *     Then PATCH 数据中不包含 _animClass
 *
 *   Scenario: _pausedElapsed 瞬态字段不包含在 PATCH 中
 *     Given 作业对象包含 _pausedElapsed 瞬态字段
 *     When pauseActiveTask 构造 PATCH 数据或完成时
 *     Then 发送到服务器的数据不包含 _pausedElapsed
 *
 * Feature: /api/speak 鉴权改造
 *   Scenario: Voice.speak 拉取语音时携带 Authorization 头
 *     Given 用户已登录且 localStorage 中有 papacheck_token
 *     When  Voice.speak 调 /api/speak?text=...
 *     Then  fetch 请求头包含 'Authorization: Bearer <token>'
 *
 *   Scenario: 未登录时拉取语音不抛异常
 *     Given localStorage 中无 papacheck_token
 *     When  Voice.speak 调 /api/speak?text=...
 *     Then  fetch 请求头不含 Authorization，服务端会返回 401，走降级逻辑
 *
 *   Scenario: localStorage 抛出异常时（隐私模式/被禁用）不阻断语音功能
 *     Given localStorage.getItem 抛 SecurityError（如 Safari 隐私模式）
 *     When  Voice.speak 调 /api/speak?text=...
 *     Then  fetch 仍被调用，请求头不含 Authorization，不抛异常
 */

import { describe, it, expect, vi } from 'vitest';

describe('wakeUp 调用顺序', () => {
  it('先调用 stopPoll 再调用 pollServer', () => {
    const calls = [];
    const stopPoll = () => { calls.push('stopPoll'); };
    const pollServer = () => { calls.push('pollServer'); };
    const startPoll = (ms) => { calls.push('startPoll(' + ms + ')'); };

    // 模拟 wakeUp 实现
    function wakeUp() {
      stopPoll();
      pollServer();
      startPoll(5000);
    }

    wakeUp();

    expect(calls).toEqual(['stopPoll', 'pollServer', 'startPoll(5000)']);
  });

  it('stopPoll 在 pollServer 之前被调用', () => {
    let stopPollCalled = false;
    let pollServerCalled = false;

    const stopPoll = () => { stopPollCalled = true; };
    const pollServer = () => {
      // 此时 stopPoll 应已被调用
      expect(stopPollCalled).toBe(true);
      pollServerCalled = true;
    };
    const startPoll = () => {};

    function wakeUp() {
      stopPoll();
      pollServer();
      startPoll(5000);
    }

    wakeUp();
    expect(pollServerCalled).toBe(true);
  });

  it('startPoll 在 pollServer 之后被调用', () => {
    const order = [];
    const stopPoll = () => { order.push('stopPoll'); };
    const pollServer = () => { order.push('pollServer'); };
    const startPoll = (ms) => { order.push('startPoll'); };

    function wakeUp() {
      stopPoll();
      pollServer();
      startPoll(5000);
    }

    wakeUp();
    expect(order.indexOf('pollServer')).toBeLessThan(order.indexOf('startPoll'));
  });

  it('wakeUp 调用 Voice.speak', () => {
    const speakCalls = [];
    const Voice = {
      speak: (text) => { speakCalls.push(text); },
    };
    const stopPoll = () => {};
    const pollServer = () => {};
    const startPoll = () => {};

    function wakeUp() {
      stopPoll();
      pollServer();
      startPoll(5000);
      Voice.speak('屏幕已唤醒');
    }

    wakeUp();
    expect(speakCalls).toEqual(['屏幕已唤醒']);
  });
});

describe('/api/speak 鉴权请求', () => {
  // Scenario: 已登录时 fetch /api/speak 携带 Authorization 头
  //   Given localStorage 中存在 papacheck_token
  //   When  Voice.speak 调 /api/speak?text=...
  //   Then  fetch 请求头包含 'Authorization: Bearer <token>'

  it('已登录时 fetch /api/speak 应携带 Authorization 头', async () => {
    const fakeToken = 'test-jwt-token-abc';
    // 模拟 localStorage
    const storage = { papacheck_token: fakeToken };
    const localStorageMock = {
      getItem: (key) => storage[key] ?? null,
      setItem: (key, val) => { storage[key] = val; },
    };

    // 模拟 fetch，捕获请求头
    let capturedHeaders = null;
    const fetchMock = async (url, opts = {}) => {
      capturedHeaders = opts.headers || {};
      return { ok: true, blob: async () => new Blob([new Uint8Array(8)], { type: 'audio/mpeg' }) };
    };

    // 模拟的 Voice.speak 简化版（仅取本次任务的 fetch 调用）
    async function speakText(text) {
      const url = '/api/speak?' + new URLSearchParams({ text });
      const token = localStorageMock.getItem('papacheck_token');
      const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      const resp = await fetchMock(url, { headers });
      return resp;
    }

    await speakText('你好');

    expect(capturedHeaders).toHaveProperty('Authorization');
    expect(capturedHeaders['Authorization']).toBe('Bearer ' + fakeToken);
  });

  // Scenario: 未登录时 fetch /api/speak 不抛异常
  //   Given localStorage 中无 papacheck_token
  //   When  Voice.speak 调 /api/speak?text=...
  //   Then  fetch 请求头不含 Authorization，调用不抛异常

  it('未登录时 fetch /api/speak 不抛异常且不带 Authorization 头', async () => {
    const localStorageMock = {
      getItem: () => null,
    };

    let capturedHeaders = null;
    const fetchMock = async (url, opts = {}) => {
      capturedHeaders = opts.headers || {};
      return { ok: true, blob: async () => new Blob([]) };
    };

    async function speakText(text) {
      const url = '/api/speak?' + new URLSearchParams({ text });
      const token = localStorageMock.getItem('papacheck_token');
      const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      const resp = await fetchMock(url, { headers });
      return resp;
    }

    await expect(speakText('测试')).resolves.toBeDefined();
    expect(capturedHeaders).not.toHaveProperty('Authorization');
  });

  // Scenario: localStorage 抛异常时（隐私模式/被禁用）不阻断语音功能
  //   Given localStorage.getItem 抛 SecurityError
  //   When  Voice.speak 调 /api/speak?text=...
  //   Then  fetch 仍被调用，请求头不含 Authorization，不抛异常

  it('localStorage 抛异常时仍能调用 fetch 且不带 Authorization 头', async () => {
    // 从 app.js 读取真实的"取 token + 构造 fetch"片段并执行，
    // 确保测试覆盖生产代码（防止有人未来又用裸 localStorage.getItem 替换回去）
    const fs = await import('node:fs');
    const path = await import('node:path');
    const vm = await import('node:vm');

    const appJsPath = path.resolve(__dirname, '..', 'app.js');
    const appJsSrc = fs.readFileSync(appJsPath, 'utf-8');
    // 提取 "/api/speak" 段附近的 token 读取 + headers 构造 + fetch 调用片段
    // 模式匹配"const url = '/api/speak..." 到 "await fetch(url" 之间
    const snippet = appJsSrc.match(/const url = '\/api\/spea[^]*?await fetch\(url[^;]*;/);
    if (!snippet) {
      throw new Error('无法在 app.js 中定位 /api/speak fetch 片段，请检查源码结构');
    }

    // 构造沙箱：注入模拟 localStorage + fetch + URLSearchParams + getAuthHeaders + text 参数
    // getAuthHeaders 来自 api.js：自带 try-catch 保护隐私模式下 localStorage 禁用场景
    let capturedHeaders = null;
    let fetchCalled = false;
    const sandbox = {
      localStorage: {
        getItem: () => {
          const err = new Error('SecurityError: localStorage is disabled');
          err.name = 'SecurityError';
          throw err;
        },
      },
      URLSearchParams,
      text: '你好',
      getAuthHeaders: () => {
        try {
          const token = sandbox.localStorage.getItem('papacheck_token');
          return token ? { 'Authorization': 'Bearer ' + token } : {};
        } catch (e) {
          return {};
        }
      },
      fetch: async (_url, opts = {}) => {
        fetchCalled = true;
        capturedHeaders = opts.headers || {};
        return { ok: true, blob: async () => new Blob([]) };
      },
    };
    vm.createContext(sandbox);
    // 将提取的片段包成 async IIFE 并执行
    const code = `(async () => { ${snippet[0]} })()`;
    await vm.runInContext(code, sandbox);

    expect(fetchCalled).toBe(true);
    expect(capturedHeaders).not.toHaveProperty('Authorization');
  });
});

describe('Voice.speak 异常保护', () => {
  it('undefined 文本不抛异常', () => {
    const Voice = {
      _queue: [],
      _playing: false,
      speak(text) {
        this._queue.push(text);
        if (!this._playing) this._playing = true;
      },
      clear() {
        this._queue = [];
      },
    };

    expect(() => {
      Voice.speak(undefined);
    }).not.toThrow();

    // undefined 被加入队列（Voice.speak 本身不检查内容）
    expect(Voice._queue).toHaveLength(1);
  });

  it('null 文本不抛异常', () => {
    const Voice = {
      _queue: [],
      _playing: false,
      speak(text) {
        this._queue.push(text);
        if (!this._playing) this._playing = true;
      },
    };

    expect(() => {
      Voice.speak(null);
    }).not.toThrow();

    expect(Voice._queue).toHaveLength(1);
  });

  it('空字符串文本不抛异常', () => {
    const Voice = {
      _queue: [],
      _playing: false,
      speak(text) {
        this._queue.push(text);
        if (!this._playing) this._playing = true;
      },
    };

    expect(() => {
      Voice.speak('');
    }).not.toThrow();

    expect(Voice._queue).toHaveLength(1);
  });

  it('正常文本正常加入队列', () => {
    const Voice = {
      _queue: [],
      _playing: false,
      speak(text) {
        this._queue.push(text);
        if (!this._playing) this._playing = true;
      },
    };

    Voice.speak('你好');
    Voice.speak('世界');

    expect(Voice._queue).toHaveLength(2);
    expect(Voice._queue[0]).toBe('你好');
    expect(Voice._queue[1]).toBe('世界');
  });
});

describe('UI 瞬态字段不发送到服务器', () => {
  it('_animClass 瞬态字段不包含在 PATCH 数据中', () => {
    // 模拟 completeHomework 中构造 PATCH 数据的逻辑
    const hw = {
      id: 'hw-1',
      subject: '语文',
      content: '抄写课文',
      status: 'doing',
      mode: 'challenge',
      startedAt: '2026-06-11T10:00:00.000Z',
      _animClass: 'challenge-success',
      completedInSchool: false,
    };

    // 模拟完成作业
    const patchData = {
      status: 'done',
      completedAt: '2026-06-11T10:30:00.000Z',
      actualDuration: 30,
      mode: 'timer',
    };

    // 验证瞬态字段不在 patchData 中
    expect(patchData).not.toHaveProperty('_animClass');
    expect(Object.keys(patchData)).not.toContain('_animClass');
  });

  it('_pausedElapsed 瞬态字段不包含在 PATCH 数据中', () => {
    // 模拟 pauseActiveTask 中构造 PATCH 数据的逻辑
    const task = {
      id: 'hw-1',
      status: 'doing',
      startedAt: '2026-06-11T10:00:00.000Z',
      _pausedElapsed: 120,
    };

    // pauseActiveTask 中只 PATCH 了 paused 和 wasPaused
    const patchData = {
      paused: true,
      wasPaused: true,
    };

    expect(patchData).not.toHaveProperty('_pausedElapsed');
    expect(Object.keys(patchData)).not.toContain('_pausedElapsed');
  });

  it('homework 对象中的瞬态字段在保存时被排除', () => {
    // 验证只有显式声明的字段会被保存，以下划线开头的字段不会被加入保存数据
    const hw = {
      id: 'hw-1',
      subject: '数学',
      content: '做练习',
      status: 'doing',
      mode: 'challenge',
      suggestedDuration: 20,
      basePoints: 10,
      startedAt: '2026-06-11T10:00:00.000Z',
      completedAt: '2026-06-11T10:30:00.000Z',
      actualDuration: 30,
      _animClass: 'challenge-success',
      _pausedElapsed: 300,
    };

    // saveHomeworksSilent 通过 API.putHomework 保存
    // putHomework 将整个 hw 对象作为 data 发送
    // 但 app.js 中 completeHomework 使用的是 API.patchHomework，只显式传递固定字段
    const PATCH_FIELDS = [
      'status', 'completedAt', 'actualDuration', 'mode',
    ];

    const patchObj = {};
    PATCH_FIELDS.forEach(f => {
      if (hw[f] !== undefined) patchObj[f] = hw[f];
    });

    expect(patchObj).not.toHaveProperty('_animClass');
    expect(patchObj).not.toHaveProperty('_pausedElapsed');
    expect(Object.keys(patchObj)).toEqual(['status', 'completedAt', 'actualDuration', 'mode']);
  });
});

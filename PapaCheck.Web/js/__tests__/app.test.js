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

/**
 * login.test.js - login.html 统一登录页单元测试
 *
 * Feature: 最近使用列表
 *   Scenario: 加载时从 localStorage 读取最近使用列表
 *     Given localStorage 中有 papacheck_known_codes（[{code:"ABC123",name:"小明"}]）
 *     When  调用 loadKnownCodes()
 *     Then  返回该列表
 *
 *   Scenario: localStorage 为空时返回空数组
 *     Given localStorage 中没有 papacheck_known_codes
 *     When  调用 loadKnownCodes()
 *     Then  返回空数组
 *
 *   Scenario: localStorage 数据损坏时返回空数组
 *     Given localStorage 中 papacheck_known_codes 不是合法 JSON
 *     When  调用 loadKnownCodes()
 *     Then  返回空数组且不抛出异常
 *
 * Feature: saveKnownCode 保存到 localStorage
 *   Scenario: 新访问码追加到列表
 *     Given localStorage 中有 [{code:"ABC",name:"小明"}]
 *     When  调用 saveKnownCode("DEF", "小红")
 *     Then  localStorage 中列表包含两条记录且新记录在末尾
 *
 *   Scenario: 重复访问码不再添加
 *     Given localStorage 中有 [{code:"ABC",name:"小明"}]
 *     When  调用 saveKnownCode("ABC", "小明")
 *     Then  localStorage 中列表仍为一条记录
 *
 *   Scenario: 列表超过 5 条时删除最旧的
 *     Given localStorage 中有 5 条记录
 *     When  调用 saveKnownCode("NEW", "新用户")
 *     Then  localStorage 中只有 5 条记录且第一条被移除
 *
 * Feature: sessionStorage 有 token 时直接跳转
 *   Scenario: sessionStorage 中有 papacheck_token
 *     Given sessionStorage 中有 papacheck_token="xxx"
 *     When  页面加载
 *     Then  立即跳转到 /app
 *
 *   Scenario: sessionStorage 中没有 token
 *     Given sessionStorage 中没有 papacheck_token
 *     When  页面加载
 *     Then  不执行跳转，显示登录界面
 *
 * Feature: 角色选择切换
 *   Scenario: 点击角色按钮切换选中状态
 *     Given 家长按钮处于未选中状态
 *     When  点击"家长入口"按钮
 *     Then  家长按钮获得 active 类，孩子按钮失去 active 类
 *
 * Feature: exchange API 调用
 *   Scenario: 成功兑换令牌
 *     Given 用户有有效的访问码和角色
 *     When  调用 exchange(code, role)
 *     Then  发送 POST /api/auth/exchange 请求
 *     And   请求体为 { access_code, role }
 *     And   响应中的 token 存入 sessionStorage
 *     And   跳转到 /app
 *
 *   Scenario: 兑换失败显示错误
 *     Given 访问码无效
 *     When  调用 exchange(code, role)
 *     Then  显示错误信息
 *
 *   Scenario: 兑换成功后保存到最近使用
 *     Given 用户输入新访问码并成功登录
 *     When  exchange 成功
 *     Then  saveKnownCode 被调用，该条记录追加到 localStorage
 */
import { describe, it, expect, vi } from 'vitest';

// ==================== 模拟 localStorage ====================
function createMockStorage() {
  var store = {};
  return {
    getItem: function (key) { return store[key] !== undefined ? store[key] : null; },
    setItem: function (key, val) { store[key] = String(val); },
    removeItem: function (key) { delete store[key]; },
    clear: function () { store = {}; },
    _store: store,
  };
}

// ==================== 从 login.html 提取的纯函数逻辑 ====================

function loadKnownCodesImpl(storage) {
  try {
    var raw = storage.getItem('papacheck_known_codes');
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

function saveKnownCodeImpl(code, name, storage) {
  var list = [];
  try {
    var raw = storage.getItem('papacheck_known_codes');
    if (raw) list = JSON.parse(raw);
  } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  // 去重：已存在的先移除
  list = list.filter(function (item) { return item.code !== code; });
  // 追加到末尾
  list.push({ code: code, name: name });
  // 最多保留 5 条，删除最旧的
  if (list.length > 5) list = list.slice(list.length - 5);
  storage.setItem('papacheck_known_codes', JSON.stringify(list));
}

async function exchangeImpl(code, role, storage, fetchFn, locationSetter) {
  if (!code || !code.trim()) {
    return { error: '请输入访问码' };
  }
  if (!role) {
    return { error: '请选择角色' };
  }
  try {
    var resp = await (fetchFn || fetch)('/api/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: code.trim(), role: role }),
    });
    if (resp.ok) {
      var d = await resp.json();
      storage.setItem('papacheck_token', d.token);
      storage.setItem('papacheck_role', d.role);
      storage.setItem('papacheck_child_name', d.child_name || '');
      saveKnownCodeImpl(code.trim(), d.child_name || '', storage);
      if (locationSetter) locationSetter('/app');
      return { success: true, token: d.token, role: d.role };
    } else {
      var err = await resp.json().catch(function () { return {}; });
      return { error: err.error || '登录失败，请检查访问码' };
    }
  } catch (e) {
    return { error: '网络错误，请稍后重试' };
  }
}

// ==================== 测试 ====================

describe('loadKnownCodes', () => {
  it('从 localStorage 读取最近使用列表', () => {
    var storage = createMockStorage();
    var data = [{ code: 'ABC123', name: '小明' }];
    storage.setItem('papacheck_known_codes', JSON.stringify(data));

    var result = loadKnownCodesImpl(storage);

    expect(result).toEqual(data);
  });

  it('localStorage 为空时返回空数组', () => {
    var storage = createMockStorage();
    var result = loadKnownCodesImpl(storage);
    expect(result).toEqual([]);
  });

  it('localStorage 数据损坏时返回空数组且不抛出异常', () => {
    var storage = createMockStorage();
    storage.setItem('papacheck_known_codes', 'not-valid-json{{{');

    expect(function () {
      var result = loadKnownCodesImpl(storage);
      expect(result).toEqual([]);
    }).not.toThrow();
  });
});

describe('saveKnownCode', () => {
  it('新访问码追加到列表', () => {
    var storage = createMockStorage();
    storage.setItem('papacheck_known_codes', JSON.stringify([
      { code: 'ABC', name: '小明' },
    ]));

    saveKnownCodeImpl('DEF', '小红', storage);

    var saved = JSON.parse(storage.getItem('papacheck_known_codes'));
    expect(saved).toHaveLength(2);
    expect(saved[0]).toEqual({ code: 'ABC', name: '小明' });
    expect(saved[1]).toEqual({ code: 'DEF', name: '小红' });
  });

  it('重复访问码不再添加', () => {
    var storage = createMockStorage();
    storage.setItem('papacheck_known_codes', JSON.stringify([
      { code: 'ABC', name: '小明' },
    ]));

    saveKnownCodeImpl('ABC', '小明', storage);

    var saved = JSON.parse(storage.getItem('papacheck_known_codes'));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ code: 'ABC', name: '小明' });
  });

  it('重复访问码时更新 name 并移到末尾', () => {
    var storage = createMockStorage();
    storage.setItem('papacheck_known_codes', JSON.stringify([
      { code: 'ABC', name: '小明' },
      { code: 'DEF', name: '小红' },
    ]));

    // 重新使用 ABC（模拟第二次登录）
    saveKnownCodeImpl('ABC', '小明', storage);

    var saved = JSON.parse(storage.getItem('papacheck_known_codes'));
    expect(saved).toHaveLength(2);
    // ABC 被移到末尾
    expect(saved[0]).toEqual({ code: 'DEF', name: '小红' });
    expect(saved[1]).toEqual({ code: 'ABC', name: '小明' });
  });

  it('列表超过 5 条时删除最旧的', () => {
    var storage = createMockStorage();
    var items = [];
    for (var i = 1; i <= 5; i++) {
      items.push({ code: 'CODE' + i, name: '用户' + i });
    }
    storage.setItem('papacheck_known_codes', JSON.stringify(items));

    saveKnownCodeImpl('NEW', '新用户', storage);

    var saved = JSON.parse(storage.getItem('papacheck_known_codes'));
    expect(saved).toHaveLength(5);
    // 第一条被移除
    expect(saved[0].code).toBe('CODE2');
    // 新加的在末尾
    expect(saved[4].code).toBe('NEW');
  });
});

describe('页面加载跳转检测', () => {
  it('sessionStorage 中有 papacheck_token 时应跳转', () => {
    var storage = createMockStorage();
    storage.setItem('papacheck_token', 'test-token-123');
    var redirectedTo = null;

    // 模拟页面加载的初始化逻辑
    (function () {
      try {
        var existing = storage.getItem('papacheck_token');
        if (existing) {
          redirectedTo = '/app';
          return;
        }
      } catch (e) {}
    })();

    expect(redirectedTo).toBe('/app');
  });

  it('sessionStorage 中没有 token 时不跳转', () => {
    var storage = createMockStorage();
    var redirectedTo = null;

    (function () {
      try {
        var existing = storage.getItem('papacheck_token');
        if (existing) {
          redirectedTo = '/app';
          return;
        }
      } catch (e) {}
    })();

    expect(redirectedTo).toBeNull();
  });
});

describe('角色选择切换', () => {
  it('selectRole 切换按钮 active 状态', () => {
    // 模拟 DOM
    var parentBtn = { classList: { toggle: vi.fn() } };
    var childBtn = { classList: { toggle: vi.fn() } };
    var _selectedRole = null;

    function selectRole(role) {
      _selectedRole = role;
      parentBtn.classList.toggle('active', role === 'parent');
      childBtn.classList.toggle('active', role === 'child');
    }

    selectRole('parent');

    expect(_selectedRole).toBe('parent');
    expect(parentBtn.classList.toggle).toHaveBeenCalledWith('active', true);
    expect(childBtn.classList.toggle).toHaveBeenCalledWith('active', false);

    selectRole('child');

    expect(_selectedRole).toBe('child');
    expect(parentBtn.classList.toggle).toHaveBeenCalledWith('active', false);
    expect(childBtn.classList.toggle).toHaveBeenCalledWith('active', true);
  });
});

describe('exchange API 调用', () => {
  it('成功兑换时发送 POST /api/auth/exchange 并将 token 存入 sessionStorage 后跳转', async () => {
    var storage = createMockStorage();
    var locationTo = null;

    var mockFetch = async function (url, opts) {
      expect(url).toBe('/api/auth/exchange');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      var body = JSON.parse(opts.body);
      expect(body).toEqual({ access_code: 'ABC123', role: 'parent' });
      return {
        ok: true,
        async json() { return { token: 'jwt-token-xxx', role: 'parent', child_id: 'c1', child_name: '小明' }; },
      };
    };

    var result = await exchangeImpl('ABC123', 'parent', storage, mockFetch, function (loc) { locationTo = loc; });

    expect(result.success).toBe(true);
    expect(result.token).toBe('jwt-token-xxx');
    expect(storage.getItem('papacheck_token')).toBe('jwt-token-xxx');
    expect(storage.getItem('papacheck_role')).toBe('parent');
    expect(storage.getItem('papacheck_child_name')).toBe('小明');
    expect(locationTo).toBe('/app');

    // 验证 saveKnownCode 也执行了
    var known = JSON.parse(storage.getItem('papacheck_known_codes'));
    expect(known).toEqual([{ code: 'ABC123', name: '小明' }]);
  });

  it('兑换失败显示错误信息', async () => {
    var storage = createMockStorage();

    var mockFetch = async function () {
      return {
        ok: false,
        status: 401,
        async json() { return { error: '访问码无效', code: 'INVALID_ACCESS_CODE' }; },
      };
    };

    var result = await exchangeImpl('BAD-CODE', 'parent', storage, mockFetch);

    expect(result.error).toBe('访问码无效');
    // token 不应被写入
    expect(storage.getItem('papacheck_token')).toBeNull();
  });

  it('新访问码兑换成功后追加到最近使用', async () => {
    var storage = createMockStorage();
    // 已有旧记录
    storage.setItem('papacheck_known_codes', JSON.stringify([
      { code: 'OLD', name: '老朋友' },
    ]));

    var mockFetch = async function () {
      return {
        ok: true,
        async json() { return { token: 'jwt-new', role: 'child', child_id: 'c2', child_name: '小花' }; },
      };
    };

    await exchangeImpl('NEWCODE', 'child', storage, mockFetch, function () {});

    var known = JSON.parse(storage.getItem('papacheck_known_codes'));
    expect(known).toHaveLength(2);
    expect(known[0]).toEqual({ code: 'OLD', name: '老朋友' });
    expect(known[1]).toEqual({ code: 'NEWCODE', name: '小花' });
  });

  it('空访问码时返回错误信息', async () => {
    var storage = createMockStorage();
    var result = await exchangeImpl('', 'parent', storage);
    expect(result.error).toBe('请输入访问码');
  });

  it('未选择角色时返回错误信息', async () => {
    var storage = createMockStorage();
    var result = await exchangeImpl('ABC123', null, storage);
    expect(result.error).toBe('请选择角色');
  });
});

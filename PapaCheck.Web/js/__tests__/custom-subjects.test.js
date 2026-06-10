// Feature: 自定义科目 settings 加载
//   Scenario: 无 subjects 字段时使用默认值
//     Given settings 对象中没有 subjects 字段
//     When 调用 getSetting('subjects')
//     Then 返回默认 5 科（语文/数学/英语/科学/其他）
//
//   Scenario: subjects 字段存在时正确读取
//     Given settings 对象中包含 subjects 字段
//     When 调用 getSetting('subjects')
//     Then 返回 subjects 数组
//
//   Scenario: subjects 字段为空数组时回退到默认值
//     Given settings 对象中 subjects 字段为空数组
//     When 调用 ensureSubjects(settings)
//     Then subjects 被补全为默认 5 科
//
//   Scenario: 补全缺失的 subjects 字段
//     Given adminSettings 加载后 subjects 字段缺失
//     When adminSettings 加载完成
//     Then subjects 字段被自动补全为默认值
//
//   Scenario: 补全后进行深拷贝，不引用默认值对象
//     Given SETTINGS_DEFAULTS.subjects 为默认值
//     When 调用 ensureSubjects 补全后修改 subjects 数组
//     Then SETTINGS_DEFAULTS.subjects 不受影响
//
//   Scenario: 自定义科目内容能正确持久化
//     Given subjects 中包含自定义科目"物理"
//     When 调用 getSetting('subjects')
//     Then 返回的数组中包含"物理"
//
//   Scenario: subjects 加载不影响 settings 中其他字段
//     Given settings 中包含 dailyBasePoints 和 subjects
//     When 加载 settings
//     Then dailyBasePoints 和 subjects 各自独立正确

import { describe, it, expect } from 'vitest';

const SETTINGS_DEFAULTS = {
  dailyBasePoints: 50,
  homeworkBonusPerTask: 10,
  homeworkDefaultSuggestedDuration: 20,
  ratingMultipliers: { '优': 2.0, '良': 1.5, '可': 1.2, '差': 0 },
  shopDefaultPoints: 50,
  subjects: [
    { id: '语文', icon: '📖', color: '#f87171' },
    { id: '数学', icon: '🔢', color: '#60a5fa' },
    { id: '英语', icon: '🔤', color: '#fbbf24' },
    { id: '科学', icon: '🔬', color: '#4ade80' },
    { id: '其他', icon: '📚', color: '#a78bfa' },
  ],
};

function getSetting(adminSettings, key) {
  const val = adminSettings[key];
  if (val !== undefined && val !== null) return val;
  return SETTINGS_DEFAULTS[key];
}

function ensureSubjects(adminSettings) {
  if (!adminSettings.subjects || adminSettings.subjects.length === 0) {
    adminSettings.subjects = SETTINGS_DEFAULTS.subjects.map(s => ({ ...s }));
  }
}

describe('subjects settings 加载', () => {
  it('无 subjects 字段时返回默认值', () => {
    const result = getSetting({ dailyBasePoints: 60 }, 'subjects');
    expect(result).toEqual(SETTINGS_DEFAULTS.subjects);
  });

  it('subjects 字段存在时正确读取', () => {
    const customSubjects = [{ id: '物理', icon: '⚛️', color: '#ff69b4' }];
    const result = getSetting({ subjects: customSubjects }, 'subjects');
    expect(result).toEqual(customSubjects);
  });

  it('subjects 为空数组时回退到默认值', () => {
    const settings = { subjects: [] };
    ensureSubjects(settings);
    expect(settings.subjects.length).toBe(5);
    expect(settings.subjects).toEqual(SETTINGS_DEFAULTS.subjects);
  });

  it('补全缺失的 subjects 字段', () => {
    const settings = {};
    ensureSubjects(settings);
    expect(settings.subjects).toEqual(SETTINGS_DEFAULTS.subjects);
  });

  it('补全后进行深拷贝，不引用默认值对象', () => {
    const settings = {};
    ensureSubjects(settings);
    settings.subjects.pop();
    expect(SETTINGS_DEFAULTS.subjects.length).toBe(5);
  });

  it('自定义科目内容正确持久化', () => {
    const customSubjects = [{ id: '物理', icon: '⚛️', color: '#ff69b4' }];
    const result = getSetting({ subjects: customSubjects }, 'subjects');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('物理');
  });

  it('subjects 不影响 settings 中其他字段', () => {
    const settings = { dailyBasePoints: 100, subjects: [{ id: '物理' }] };
    const subjects = getSetting(settings, 'subjects');
    const points = getSetting(settings, 'dailyBasePoints');
    expect(points).toBe(100);
    expect(subjects).toEqual([{ id: '物理' }]);
  });
});

// Feature: 「其他」始终在最后
//   Scenario: 排序函数将其他排到最后
//     Given 科目列表为 ["物理", "数学", "其他", "语文"]
//     When 调用 sortSubjectsWithOtherLast
//     Then 返回 ["物理", "数学", "语文", "其他"]
//
//   Scenario: 无其他时返回原顺序
//     Given 科目列表为 ["物理", "数学", "语文"]
//     When 调用 sortSubjectsWithOtherLast
//     Then 返回 ["物理", "数学", "语文"]

describe('sortSubjectsWithOtherLast', () => {
  function sortSubjectsWithOtherLast(subjects) {
    const others = subjects.filter(s => s.id === '其他');
    const rest = subjects.filter(s => s.id !== '其他');
    return [...rest, ...others];
  }

  it('将其他排到最后', () => {
    const subjects = [
      { id: '物理', icon: '⚛️' },
      { id: '数学', icon: '🔢' },
      { id: '其他', icon: '📚' },
      { id: '语文', icon: '📖' },
    ];
    const result = sortSubjectsWithOtherLast(subjects);
    expect(result[0].id).toBe('物理');
    expect(result[1].id).toBe('数学');
    expect(result[2].id).toBe('语文');
    expect(result[3].id).toBe('其他');
  });

  it('无其他时返回原顺序', () => {
    const subjects = [
      { id: '物理', icon: '⚛️' },
      { id: '数学', icon: '🔢' },
    ];
    const result = sortSubjectsWithOtherLast(subjects);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('物理');
    expect(result[1].id).toBe('数学');
  });
});

// Feature: 设置页科目管理工具函数
//   Scenario: getActiveSubjects 返回 settings 中的 subjects
//     Given settings.subjects 包含"语文"和"物理"
//     When 调用 getActiveSubjects(settings)
//     Then 返回包含这两个科目的数组
//
//   Scenario: addSubject 追加科目到列表末尾
//     Given 当前科目列表有 5 个默认科目
//     When 调用 addSubject(subjects, "物理", "⚛️", "#888")
//     Then 返回 6 个科目的数组，末尾为"物理"
//
//   Scenario: removeSubject 从列表中移除科目
//     Given 当前科目列表中有"科学"
//     When 调用 removeSubject(subjects, "科学")
//     Then 返回 4 个科目的数组，不包含"科学"
//
//   Scenario: getMissingDefaults 返回不在当前列表中的默认科目
//     Given 当前列表包含"语文/数学/物理"，缺少"英语/科学/其他"
//     When 调用 getMissingDefaults(currentSubjects)
//     Then 返回 ["英语", "科学", "其他"]
//
//   Scenario: matchSubjectIcon 常见科目自动匹配
//     Given 输入"物理"
//     When 调用 matchSubjectIcon("物理")
//     Then 返回 "⚛️"
//
//   Scenario: matchSubjectIcon 不常见科目使用默认图标
//     Given 输入"围棋"
//     When 调用 matchSubjectIcon("围棋")
//     Then 返回 "📝"

const SUBJECT_ICON_PRESETS = {
  '道德与法治': '⚖️', '道法': '⚖️',
  '物理': '⚛️', '化学': '🧪', '生物': '🧬',
  '历史': '📜', '地理': '🌍',
  '音乐': '🎵', '美术': '🎨', '体育': '⚽',
  '信息': '💻', '信息科技': '💻', '编程': '🤖',
  '书法': '✍️', '劳动': '🧹', '心理': '🧠',
};

function getActiveSubjects(settings) {
  return settings?.subjects || SETTINGS_DEFAULTS.subjects;
}

function addSubject(subjects, id, icon, color) {
  return [...subjects, { id, icon, color }];
}

function removeSubject(subjects, id) {
  return subjects.filter(s => s.id !== id);
}

function getMissingDefaults(currentSubjects) {
  return SETTINGS_DEFAULTS.subjects.filter(d => !currentSubjects.some(s => s.id === d.id));
}

function matchSubjectIcon(name) {
  return SUBJECT_ICON_PRESETS[name] || '📝';
}

describe('科目管理纯函数', () => {
  it('getActiveSubjects 返回 settings 中的 subjects', () => {
    const settings = {
      subjects: [
        { id: '语文', icon: '📖', color: '#f87171' },
        { id: '物理', icon: '⚛️', color: '#888' },
      ],
    };
    const result = getActiveSubjects(settings);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('语文');
    expect(result[1].id).toBe('物理');
  });

  it('addSubject 追加科目到列表末尾', () => {
    const subjects = SETTINGS_DEFAULTS.subjects.map(s => ({ ...s }));
    const result = addSubject(subjects, '物理', '⚛️', '#888');
    expect(result).toHaveLength(6);
    expect(result[5].id).toBe('物理');
    expect(result[5].icon).toBe('⚛️');
  });

  it('removeSubject 从列表中移除科目', () => {
    const subjects = SETTINGS_DEFAULTS.subjects.map(s => ({ ...s }));
    const result = removeSubject(subjects, '科学');
    expect(result).toHaveLength(4);
    expect(result.find(s => s.id === '科学')).toBeUndefined();
  });

  it('getMissingDefaults 返回不在当前列表中的默认科目', () => {
    const current = [
      { id: '语文', icon: '📖' },
      { id: '数学', icon: '🔢' },
      { id: '物理', icon: '⚛️' },
    ];
    const missing = getMissingDefaults(current);
    expect(missing).toHaveLength(3);
    expect(missing.map(s => s.id)).toEqual(['英语', '科学', '其他']);
  });

  it('matchSubjectIcon 常见科目自动匹配', () => {
    expect(matchSubjectIcon('物理')).toBe('⚛️');
    expect(matchSubjectIcon('历史')).toBe('📜');
    expect(matchSubjectIcon('音乐')).toBe('🎵');
    expect(matchSubjectIcon('道德与法治')).toBe('⚖️');
    expect(matchSubjectIcon('信息科技')).toBe('💻');
  });

  it('matchSubjectIcon 不常见科目使用默认图标', () => {
    expect(matchSubjectIcon('围棋')).toBe('📝');
    expect(matchSubjectIcon('手工')).toBe('📝');
  });
});

// Feature: 动态科目选择器
//   Scenario: 作业弹窗科目选项来自 settings
//     Given adminSettings.subjects 包含 ["语文", "数学", "物理"]
//     When 渲染科目选择器
//     Then 显示 "语文" "数学" "物理" 三个选项
//
//   Scenario: 科目选项使用 getActiveSubjects 获取
//     Given adminSettings.subjects 包含自定义科目
//     When 调用 getActiveSubjects(adminSettings)
//     Then 返回的数组包含自定义科目
test('作业弹窗科目选项来自 settings', () => {
  const settings = {
    subjects: [
      { id: '语文', icon: '📖', color: '#f87171' },
      { id: '数学', icon: '🔢', color: '#60a5fa' },
      { id: '物理', icon: '⚛️', color: '#888' },
    ],
  };
  const result = getActiveSubjects(settings);
  expect(result).toHaveLength(3);
  expect(result.map(s => s.id)).toEqual(['语文', '数学', '物理']);
});

// Feature: 孩子端动态科目显示
//   Scenario: 有 settings 时从 settings 获取科目
//     Given cachedData.settings.subjects 包含 "物理": { icon: "⚛️", color: "#888" }
//     When 调用 getSubject("物理")
//     Then 返回 { icon: "⚛️", color: "#888" }
//
//   Scenario: 无 settings 时使用默认值
//     Given cachedData.settings 为 null
//     When 调用 getSubject("语文")
//     Then 返回默认 { icon: "📖", color: "#f87171" }
//
//   Scenario: 不存在的科目返回 null icon/color
//     Given cachedData.settings.subjects 中无 "围棋"
//     When 调用 getSubject("围棋")
//     Then 返回 { icon: null, color: null }
//
//   Scenario: 邮件解析的非常见科目显示纯文本
//     Given 作业 subject 为 "道德与法治" 且不在科目列表中
//     When 调用 getSubject("道德与法治")
//     Then 返回 { icon: null, color: null }

describe('孩子端 getSubject', () => {
  const DEFAULT_SUBJECTS = [
    { id: '语文', icon: '📖', color: '#f87171' },
    { id: '数学', icon: '🔢', color: '#60a5fa' },
    { id: '英语', icon: '🔤', color: '#fbbf24' },
    { id: '科学', icon: '🔬', color: '#4ade80' },
    { id: '其他', icon: '📚', color: '#a78bfa' },
  ];

  function getSubject(name, settingsSubjects) {
    const subs = settingsSubjects || DEFAULT_SUBJECTS;
    const found = subs.find(s => s.id === name);
    return found || { icon: null, color: null };
  }

  it('有 settings 时从 settings 获取科目', () => {
    const customSubjects = [
      { id: '物理', icon: '⚛️', color: '#888' },
      { id: '语文', icon: '📖', color: '#f87171' },
    ];
    const result = getSubject('物理', customSubjects);
    expect(result.icon).toBe('⚛️');
    expect(result.color).toBe('#888');
  });

  it('无 settings 时使用默认值', () => {
    const result = getSubject('语文');
    expect(result.icon).toBe('📖');
  });

  it('不存在的科目返回 null icon/color', () => {
    const result = getSubject('围棋', DEFAULT_SUBJECTS);
    expect(result.icon).toBeNull();
    expect(result.color).toBeNull();
  });

  it('邮件解析的非常见科目显示纯文本', () => {
    const result = getSubject('道德与法治', DEFAULT_SUBJECTS);
    expect(result.icon).toBeNull();
    expect(result.color).toBeNull();
  });
});

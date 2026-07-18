/**
 * stats.ts —— 跨天统计聚合的纯函数实现。
 *
 * 本文件中的算法为 admin.js `renderStatsTab()` 及其辅助函数
 * （getGroupMode / getWeekStart / formatWeekLabel / aggregateDaily /
 *  aggregateCompletionData / calcStreak / 效率比公式）的 **1:1 TypeScript 移植**，
 * 以保证「按需获取」重构后服务端聚合结果与旧前端逐字段一致（AC-2）。
 *
 * 约定（见 design-data-on-demand §E.2 / §E.3-① —— TZ 代码级固化）：
 *  - 周聚合边界（周一）必须与中国业务时区（Asia/Shanghai）语义一致，并与旧前端浏览器逐字段对齐（AC-2）。
 *  - 为避免依赖运行环境 `TZ` 环境变量（CloudBase SCF 默认 UTC，若未显式设置
 *    `TZ=Asia/Shanghai` 会导致周聚合边界偏移），本文件所有日期运算 **显式把
 *    'YYYY-MM-DD' 当作 Asia/Shanghai 日历日解析**，使用 `Date.UTC` + `getUTC*` 做
 *    确定性计算：结果与进程运行时 `TZ` 完全无关，且严格等价于旧前端在 Asia/Shanghai
 *    下用 `new Date('YYYY-MM-DD').getDay()` 得到的「周一」（已逐日期验证一致）。
 *  - 由此从代码层面固化时区（design §E.3-① 闭环），部署侧不再强制要求设置 `TZ` 环境变量。
 */

import type {
  StatsResult, StatsRange, StatsGroupMode, StatsPoint, StatsCompletionPoint, RatingHistoryItem,
} from './types.js';

// ==================== 算法移植（1:1 复刻 admin.js） ====================

/**
 * 决定聚合粒度。
 * 移植自 admin.js getGroupMode：非 all 一律按天；
 * all 下按日期数量：≤31 天→day，≤180→week，否则→month。
 */
export function getGroupMode(dateCount: number, range: StatsRange): StatsGroupMode {
  if (range !== 'all') return 'day';
  if (dateCount <= 31) return 'day';
  if (dateCount <= 180) return 'week';
  return 'month';
}

/**
 * 将 'YYYY-MM-DD' 解析为 { y, m(1-12), d }。
 * 仅做字符串拆分，不做任何时区解释，保证后续运算的确定性（TZ 代码级固化）。
 */
function parseYmd(dateStr: string): { y: number; m: number; d: number } {
  const parts = dateStr.split('-').map(Number);
  return { y: parts[0], m: parts[1], d: parts[2] };
}

/**
 * 取某日期所在「周一」的日期串（YYYY-MM-DD）。
 *
 * TZ 代码级固化（design §E.3-①）：显式把 'YYYY-MM-DD' 当作 Asia/Shanghai 日历日，
 * 用 `Date.UTC` 构造后读 `getUTCDay` / `getUTCFullYear` / `getUTCMonth` /
 * `getUTCDate` 做确定性计算。结果与运行环境 `TZ` 无关，且严格等价于旧前端在
 * Asia/Shanghai 下 `new Date('YYYY-MM-DD').getDay()` 得到的「周一」（已逐日期验证一致）。
 */
export function getWeekStart(dateStr: string): string {
  const { y, m, d } = parseYmd(dateStr);
  const base = new Date(Date.UTC(y, m - 1, d));
  const day = base.getUTCDay(); // 0=Sun ... 6=Sat，时区无关
  const diffToMonday = (day + 6) % 7; // 距本周一的天数（0~6）
  const monday = new Date(base.getTime() - diffToMonday * 86_400_000);
  const yy = monday.getUTCFullYear();
  const mm = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 格式化周标签为 M/D-M/D。移植自 admin.js formatWeekLabel（TZ 代码级固化，语义同 getWeekStart）。 */
export function formatWeekLabel(key: string): string {
  const { y, m, d } = parseYmd(key);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const fmt = (dt: Date): string => `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
  return `${fmt(start)}-${fmt(end)}`;
}

/**
 * 按 groupMode 聚合数值序列。
 *  - day：直接映射为 { label: date.slice(5), value }。
 *  - week/month：按周/月分组；mode==='mean' 取均值四舍五入，否则取和四舍五入。
 * 移植自 admin.js aggregateDaily。
 */
export function aggregateDaily(
  data: Array<{ date: string; value: number }>,
  groupMode: StatsGroupMode,
  mode?: 'mean',
): StatsPoint[] {
  if (!data.length) return [];
  if (groupMode === 'day') return data.map((d) => ({ label: d.date.slice(5), value: d.value }));

  const groups: Record<string, Array<{ date: string; value: number }>> = {};
  data.forEach((d) => {
    const key = groupMode === 'week' ? getWeekStart(d.date) : d.date.slice(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });

  return Object.entries(groups).map(([key, items]) => {
    const sum = items.reduce((s, d) => s + d.value, 0);
    const value = mode === 'mean' ? Math.round(sum / items.length) : Math.round(sum);
    return {
      label: groupMode === 'week' ? formatWeekLabel(key) : key,
      value,
    };
  });
}

/**
 * 按 groupMode 聚合「在校/在家」完成计数。
 * 移植自 admin.js aggregateCompletionData。
 */
export function aggregateCompletionData(
  data: Array<{ date: string; inSchool: number; atHome: number }>,
  groupMode: StatsGroupMode,
): StatsCompletionPoint[] {
  if (!data.length) return [];
  if (groupMode === 'day') return data.map((d) => ({
    label: d.date.slice(5),
    inSchool: d.inSchool,
    atHome: d.atHome,
  }));

  const groups: Record<string, Array<{ date: string; inSchool: number; atHome: number }>> = {};
  data.forEach((d) => {
    const key = groupMode === 'week' ? getWeekStart(d.date) : d.date.slice(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });

  return Object.entries(groups).map(([key, items]) => {
    const inSchool = items.reduce((s, d) => s + d.inSchool, 0);
    const atHome = items.reduce((s, d) => s + d.atHome, 0);
    return {
      label: groupMode === 'week' ? formatWeekLabel(key) : key,
      inSchool,
      atHome,
    };
  });
}

/**
 * 连续全勤天数。
 * 用**全量** settlement 日期（非区间），从最新日期倒序：
 *  - 已开始计数后遇到无效评级（无评级或 '差'）即中断；
 *  - 未开始计数时遇到无效评级则跳过（如当日尚未评级）。
 * 移植自 admin.js calcStreak（settlementByDate 替代全局 cachedData）。
 */
export function calcStreak(
  allDates: string[],
  settlementByDate: Record<string, any>,
): number {
  if (allDates.length === 0) return 0;
  const sorted = [...allDates].sort().reverse();
  let streak = 0;
  let started = false;
  for (const dk of sorted) {
    const s = settlementByDate[dk];
    if (s?.rating && s.rating !== '差') {
      streak++;
      started = true;
    } else if (started) {
      break;
    }
  }
  return streak;
}

// ==================== 聚合装配 ====================

export interface BuildStatsInput {
  /** 全量 settlement：date_key → settlement 对象 */
  settlementByDate: Record<string, any>;
  /** 区间 homeworks：date_key → homework 数组（已过滤 isDeleted） */
  homeworksByDate: Record<string, any[]>;
  /** 当前统计区间（已按 range 截取后的日期列表，升序） */
  dateRange: string[];
  /** 全量 settlement 日期（升序），供 calcStreak 使用 */
  allDates: string[];
  /** 统计范围 */
  range: StatsRange;
}

/**
 * 由原始数据装配 StatsResult。
 * 移植自 admin.js renderStatsTab 的逐日遍历与汇总逻辑（效率比、评级分布、
 * 在校比例、streak、均值等），仅将「读取全局 cachedData」替换为显式入参。
 */
export function buildStatsFromData(input: BuildStatsInput): StatsResult {
  const { settlementByDate, homeworksByDate, dateRange, allDates, range } = input;

  const groupMode = getGroupMode(dateRange.length, range);

  const totalMinData: Array<{ date: string; value: number }> = [];
  const effRatioData: Array<{ date: string; value: number }> = [];
  const dailyPointsData: Array<{ date: string; value: number }> = [];
  const completedInSchoolBarData: Array<{ date: string; inSchool: number; atHome: number }> = [];

  dateRange.forEach((date) => {
    const hwList = homeworksByDate[date] || [];
    const doneHw = hwList.filter((h: any) => h.status === 'done' && !h.rejected);

    // 总用时：done 且未拒作业的 actualDuration 之和
    const totalMin = doneHw.reduce((sum: number, h: any) => sum + (h.actualDuration || 0), 0);
    totalMinData.push({ date, value: totalMin });

    // 效率比：suggestedDuration>0 且 actualDuration!=null 的 suggested/actual 均值 ×100
    const effHw = doneHw.filter((h: any) => h.suggestedDuration > 0 && h.actualDuration !== null);
    const ratios = effHw.map((h: any) => h.suggestedDuration / h.actualDuration);
    const avgRatio = ratios.length > 0
      ? Math.round((ratios.reduce((a: number, b: number) => a + b, 0) / ratios.length) * 100)
      : 0;
    effRatioData.push({ date, value: avgRatio });

    // 获得积分：settlement.finalPoints ?? 0
    const settlement = settlementByDate[date];
    dailyPointsData.push({ date, value: settlement?.finalPoints ?? 0 });

    // 在校/在家完成比例
    const inSchool = doneHw.filter((h: any) => h.completedInSchool).length;
    const atHome = doneHw.length - inSchool;
    completedInSchoolBarData.push({ date, inSchool, atHome });
  });

  const totalMinutes = aggregateDaily(totalMinData, groupMode, 'mean');
  const efficiencyRatios = aggregateDaily(effRatioData, groupMode, 'mean');
  const dailyPoints = aggregateDaily(dailyPointsData, groupMode);

  // 评级历史列表（有评级日期，倒序）与评级分布计数
  const ratingsListDates = dateRange.filter((d) => settlementByDate[d]?.rating).reverse();
  const ratingCounts: Record<string, number> = {};
  ratingsListDates.forEach((d) => {
    const r = settlementByDate[d]?.rating;
    if (r) ratingCounts[r] = (ratingCounts[r] || 0) + 1;
  });
  const ratingTotal = Object.values(ratingCounts).reduce((s, c) => s + c, 0);

  const completedInSchool = aggregateCompletionData(completedInSchoolBarData, groupMode);

  const ratingsList: RatingHistoryItem[] = ratingsListDates.map((d) => {
    const s = settlementByDate[d];
    return {
      date: d,
      rating: s.rating,
      totalBeforeRating: s.totalBeforeRating,
      multiplier: s.multiplier,
      finalPoints: s.finalPoints,
    };
  });

  const streak = calcStreak(allDates, settlementByDate);

  const avgTotalMin = totalMinutes.length > 0
    ? Math.round(totalMinutes.reduce((a, b) => a + b.value, 0) / totalMinutes.length)
    : 0;
  const avgEff = efficiencyRatios.filter((e) => e.value > 0);
  const avgEffVal = avgEff.length > 0
    ? Math.round(avgEff.reduce((a, b) => a + b.value, 0) / avgEff.length)
    : 0;
  const totalPoints = dailyPoints.reduce((a, b) => a + b.value, 0);

  return {
    range,
    groupMode,
    totalMinutes,
    efficiencyRatios,
    dailyPoints,
    ratingCounts,
    ratingTotal,
    ratingsList,
    completedInSchool,
    streak,
    avgTotalMin,
    avgEffVal,
    totalPoints,
  };
}

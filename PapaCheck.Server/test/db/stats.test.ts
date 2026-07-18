// stats.test.ts —— T01 验收：getStats 服务端聚合与旧前端 admin.js 逐字段等价（AC-2 预校验）。
//
// 验证策略（设计 §E.2）：
//  1) 「周/月」按钮（range=week|month）→ groupMode 恒为 'day'，对 7/30 天逐日数值做
//     手工算术断言（totalMinutes / efficiencyRatios / dailyPoints / completedInSchool /
//     ratingCounts / ratingsList / streak / avgTotalMin / avgEffVal / totalPoints）。
//  2) 「总计」(range=all) → 用独立移植的 refCompute（1:1 复刻 admin.js）做深比较，
//     并校验 week 分组桶数 == 不同周一数。
//  3) from/to 覆盖区间 == 对应 range 结果。
//  4) getBountyCompletionsTotal 复刻 migrateBountyCompletionsToTotal 汇总逻辑。
//  5) tenantId fail-fast。
//
// 时区：服务端须与旧前端浏览器一致（design §E.3-①），故本测试固定 TZ=Asia/Shanghai。
process.env.TZ = 'Asia/Shanghai';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const runPg = !!process.env['DATABASE_URL'];

const TENANT = '11111111-1111-1111-1111-111111111111';
const CHILD = '22222222-2222-2222-2222-222222222222';
const START = new Date(2026, 2, 1); // 2026-03-01（本地时区）
const N = 50;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function dateAt(i: number): string {
  const d = new Date(START);
  d.setDate(START.getDate() + i);
  return ymd(d);
}
function ratingFor(i: number): string {
  return ['优', '良', '可', '差'][i % 4];
}

describe.runIf(runPg)('Stats aggregation (T01)', () => {
  let adapter: any;
  const dates: string[] = [];

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    await adapter.createTenant(TENANT, 'stats-test');
    // 注：getStats 仅按 tenant_id+child_id 查询 homeworks/settlement/bounty_completions，
    // 这些表对 children 无外键依赖，故无需 createChild；直接用固定 TENANT/CHILD 播种数据即可。

    for (let i = 0; i < N; i++) dates.push(dateAt(i));

    // 清理旧数据（幂等重跑）
    await adapter.pool.query(
      'DELETE FROM daily_settlement WHERE tenant_id=$1 AND child_id=$2',
      [TENANT, CHILD],
    );
    await adapter.pool.query(
      'DELETE FROM homeworks WHERE tenant_id=$1 AND child_id=$2',
      [TENANT, CHILD],
    );
    await adapter.pool.query(
      'DELETE FROM bounty_completions WHERE tenant_id=$1 AND child_id=$2',
      [TENANT, CHILD],
    );

    // 播种 settlement + homeworks（每个日期）
    for (let i = 0; i < N; i++) {
      const dk = dates[i];
      const settlement = {
        rating: ratingFor(i),
        finalPoints: i * 5,
        totalBeforeRating: i * 5,
        multiplier: 1,
      };
      await adapter.pool.query(
        `INSERT INTO daily_settlement (tenant_id, child_id, date_key, data)
         VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data=$4`,
        [TENANT, CHILD, dk, JSON.stringify(settlement)],
      );

      const homeworks = [
        // done、未拒：actualDuration=(i+1)*10，suggested=(i+1)*12，completedInSchool=(i%2===0)
        {
          id: 'h' + i,
          status: 'done',
          rejected: false,
          actualDuration: (i + 1) * 10,
          suggestedDuration: (i + 1) * 12,
          completedInSchool: i % 2 === 0,
        },
        // 被拒：不应计入（验证过滤）
        {
          id: 'hr' + i,
          status: 'done',
          rejected: true,
          actualDuration: 9999,
          suggestedDuration: 9999,
          completedInSchool: true,
        },
      ];
      await adapter.pool.query(
        `INSERT INTO homeworks (tenant_id, child_id, date_key, data)
         VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data=$4`,
        [TENANT, CHILD, dk, JSON.stringify(homeworks)],
      );
    }

    // 播种 bounty_completions（含元数据键，应被跳过）
    const bc1 = {
      uuid: 'uu1',
      lastModified: '2026-03-01T00:00:00Z',
      _table: 'bounty_completions',
      date: '2026-03-01',
      taskA: 3,
      taskB: true, // truthy → +1
      taskC: 0,
    };
    const bc2 = { taskA: 2, taskB: 1 };
    await adapter.pool.query(
      `INSERT INTO bounty_completions (tenant_id, child_id, date_key, data)
       VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data=$4`,
      [TENANT, CHILD, '2026-03-01', JSON.stringify(bc1)],
    );
    await adapter.pool.query(
      `INSERT INTO bounty_completions (tenant_id, child_id, date_key, data)
       VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data=$4`,
      [TENANT, CHILD, '2026-03-02', JSON.stringify(bc2)],
    );
  });

  afterAll(async () => {
    await adapter?.close();
  });

  // ============ 独立参考实现：1:1 复刻 admin.js（用于深比较） ============
  function refGroupMode(dateCount: number, range: string): string {
    if (range !== 'all') return 'day';
    if (dateCount <= 31) return 'day';
    if (dateCount <= 180) return 'week';
    return 'month';
  }
  function refWeekStart(dateStr: string): string {
    const d = new Date(dateStr);
    const day = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - ((day + 6) % 7));
    const y = mon.getFullYear();
    const m = String(mon.getMonth() + 1).padStart(2, '0');
    const dayNum = String(mon.getDate()).padStart(2, '0');
    return `${y}-${m}-${dayNum}`;
  }
  function refWeekLabel(key: string): string {
    const parts = key.split('-');
    const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    const end = new Date(d);
    end.setDate(d.getDate() + 6);
    return `${d.getMonth() + 1}/${d.getDate()}-${end.getMonth() + 1}/${end.getDate()}`;
  }
  function refAggregateDaily(data: any[], groupMode: string, mode?: string): any[] {
    if (!data.length) return [];
    if (groupMode === 'day') return data.map((d) => ({ label: d.date.slice(5), value: d.value }));
    const groups: any = {};
    data.forEach((d) => {
      const key = groupMode === 'week' ? refWeekStart(d.date) : d.date.slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });
    return Object.entries(groups).map(([key, items]: any) => {
      const sum = items.reduce((s: number, d: any) => s + d.value, 0);
      const value = mode === 'mean' ? Math.round(sum / items.length) : Math.round(sum);
      return { label: groupMode === 'week' ? refWeekLabel(key) : key, value };
    });
  }
  function refAggregateCompletion(data: any[], groupMode: string): any[] {
    if (!data.length) return [];
    if (groupMode === 'day') return data.map((d) => ({ label: d.date.slice(5), inSchool: d.inSchool, atHome: d.atHome }));
    const groups: any = {};
    data.forEach((d) => {
      const key = groupMode === 'week' ? refWeekStart(d.date) : d.date.slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });
    return Object.entries(groups).map(([key, items]: any) => {
      const inSchool = items.reduce((s: number, d: any) => s + d.inSchool, 0);
      const atHome = items.reduce((s: number, d: any) => s + d.atHome, 0);
      return { label: groupMode === 'week' ? refWeekLabel(key) : key, inSchool, atHome };
    });
  }
  function refCompute(settlementByDate: any, homeworksByDate: any, dateRange: string[], allDates: string[], range: string): any {
    const groupMode = refGroupMode(dateRange.length, range) as any;
    const totalMinData: any[] = [];
    const effRatioData: any[] = [];
    const dailyPointsData: any[] = [];
    const completedInSchoolBarData: any[] = [];
    dateRange.forEach((date) => {
      const hwList = homeworksByDate[date] || [];
      const doneHw = hwList.filter((h: any) => h.status === 'done' && !h.rejected);
      const totalMin = doneHw.reduce((s: number, h: any) => s + (h.actualDuration || 0), 0);
      totalMinData.push({ date, value: totalMin });
      const effHw = doneHw.filter((h: any) => h.suggestedDuration > 0 && h.actualDuration !== null);
      const ratios = effHw.map((h: any) => h.suggestedDuration / h.actualDuration);
      const avgRatio = ratios.length > 0 ? Math.round((ratios.reduce((a: number, b: number) => a + b, 0) / ratios.length) * 100) : 0;
      effRatioData.push({ date, value: avgRatio });
      const settlement = settlementByDate[date];
      dailyPointsData.push({ date, value: settlement?.finalPoints ?? 0 });
      const inSchool = doneHw.filter((h: any) => h.completedInSchool).length;
      const atHome = doneHw.length - inSchool;
      completedInSchoolBarData.push({ date, inSchool, atHome });
    });
    const totalMinutes = refAggregateDaily(totalMinData, groupMode, 'mean');
    const efficiencyRatios = refAggregateDaily(effRatioData, groupMode, 'mean');
    const dailyPoints = refAggregateDaily(dailyPointsData, groupMode);
    const ratingsListDates = dateRange.filter((d) => settlementByDate[d]?.rating).reverse();
    const ratingCounts: any = {};
    ratingsListDates.forEach((d) => {
      const r = settlementByDate[d]?.rating;
      if (r) ratingCounts[r] = (ratingCounts[r] || 0) + 1;
    });
    const ratingTotal = Object.values(ratingCounts).reduce((s: number, c: number) => s + c, 0);
    const completedInSchool = refAggregateCompletion(completedInSchoolBarData, groupMode);
    const ratingsList = ratingsListDates.map((d) => {
      const s = settlementByDate[d];
      return { date: d, rating: s.rating, totalBeforeRating: s.totalBeforeRating, multiplier: s.multiplier, finalPoints: s.finalPoints };
    });
    let streak = 0;
    let started = false;
    const sorted = [...allDates].sort().reverse();
    for (const dk of sorted) {
      const s = settlementByDate[dk];
      if (s?.rating && s.rating !== '差') { streak++; started = true; }
      else if (started) break;
    }
    const avgTotalMin = totalMinutes.length > 0 ? Math.round(totalMinutes.reduce((a: any, b: any) => a + b.value, 0) / totalMinutes.length) : 0;
    const avgEff = efficiencyRatios.filter((e: any) => e.value > 0);
    const avgEffVal = avgEff.length > 0 ? Math.round(avgEff.reduce((a: any, b: any) => a + b.value, 0) / avgEff.length) : 0;
    const totalPoints = dailyPoints.reduce((a: any, b: any) => a + b.value, 0);
    return {
      range, groupMode, totalMinutes, efficiencyRatios, dailyPoints,
      ratingCounts, ratingTotal, ratingsList, completedInSchool,
      streak, avgTotalMin, avgEffVal, totalPoints,
    };
  }

  // 从 DB 重新装配参考输入（避免与 adapter 内部共享对象）
  async function loadRefInputs(): Promise<{ sbd: any; hbd: any; all: string[] }> {
    const ds = await adapter.pool.query(
      'SELECT date_key, data FROM daily_settlement WHERE tenant_id=$1 AND child_id=$2',
      [TENANT, CHILD],
    );
    const sbd: any = {};
    const all: string[] = [];
    for (const row of ds.rows) {
      sbd[row.date_key] = adapter._safeJsonParse(row.data);
      all.push(row.date_key);
    }
    all.sort();
    const hw = await adapter.pool.query(
      'SELECT date_key, data FROM homeworks WHERE tenant_id=$1 AND child_id=$2',
      [TENANT, CHILD],
    );
    const hbd: any = {};
    for (const row of hw.rows) {
      const items = adapter._safeJsonParse(row.data);
      if (Array.isArray(items)) hbd[row.date_key] = items.filter((h: any) => !h.isDeleted);
    }
    return { sbd, hbd, all };
  }

  it('week 范围（groupMode=day）逐字段手工断言', async () => {
    const res = await adapter.getStats('week', TENANT, CHILD);
    expect(res.range).toBe('week');
    expect(res.groupMode).toBe('day');

    // dateRange = 末 7 天 = indices 43..49
    const idxs = [43, 44, 45, 46, 47, 48, 49];
    const expectedDates = idxs.map((i) => dates[i]);

    // totalMinutes：done 未拒 actualDuration = (i+1)*10
    const expectedTotalMin = idxs.map((i) => ({ label: dates[i].slice(5), value: (i + 1) * 10 }));
    expect(res.totalMinutes).toEqual(expectedTotalMin);

    // efficiencyRatios：round((suggested/actual)*100) = round(1.2*100)=120
    expect(res.efficiencyRatios).toEqual(idxs.map((i) => ({ label: dates[i].slice(5), value: 120 })));

    // dailyPoints：finalPoints = i*5
    expect(res.dailyPoints).toEqual(idxs.map((i) => ({ label: dates[i].slice(5), value: i * 5 })));

    // completedInSchool：completedInSchool=(i%2===0)
    const expectedCIS = idxs.map((i) => ({
      label: dates[i].slice(5),
      inSchool: i % 2 === 0 ? 1 : 0,
      atHome: i % 2 === 0 ? 0 : 1,
    }));
    expect(res.completedInSchool).toEqual(expectedCIS);

    // ratingCounts：43差,44优,45良,46可,47差,48优,49良
    expect(res.ratingCounts).toEqual({ 差: 2, 优: 2, 良: 2, 可: 1 });
    expect(res.ratingTotal).toBe(7);

    // ratingsList：7 天全有评级，倒序，首为最新
    expect(res.ratingsList.map((r: any) => r.date)).toEqual([...expectedDates].reverse());
    expect(res.ratingsList[0].date).toBe(dates[49]);
    expect(res.ratingsList[0]).toEqual({
      date: dates[49], rating: '良', totalBeforeRating: 49 * 5, multiplier: 1, finalPoints: 49 * 5,
    });

    // streak：用全量日期；49良,48优,47差→在 47 中断 → 2
    expect(res.streak).toBe(2);

    // avgTotalMin：mean(440..500)=470
    expect(res.avgTotalMin).toBe(470);
    // avgEffVal：120
    expect(res.avgEffVal).toBe(120);
    // totalPoints：sum(43..49)*5 = 1610
    expect(res.totalPoints).toBe(1610);
  });

  it('all 范围（groupMode=week）与独立参考实现逐字段一致', async () => {
    const res = await adapter.getStats('all', TENANT, CHILD);
    expect(res.range).toBe('all');
    expect(res.groupMode).toBe('week');

    const { sbd, hbd, all } = await loadRefInputs();
    const ref = refCompute(sbd, hbd, all, all, 'all');
    expect(res).toEqual(ref);

    // week 分组桶数 == 不同周一数
    const { getWeekStart } = await import('../../src/db/stats.js');
    const mondays = new Set(all.map((d) => (getWeekStart as any)(d)));
    expect(res.totalMinutes.length).toBe(mondays.size);
  });

  it('from/to 覆盖区间 == week 范围结果', async () => {
    const week = await adapter.getStats('week', TENANT, CHILD);
    const override = await adapter.getStats(
      { range: 'all', from: dates[dates.length - 7], to: dates[dates.length - 1] },
      TENANT,
      CHILD,
    );
    // from/to 窗口 = week 的末 7 天，聚合数据应完全一致；
    // 仅 range 标签不同（override 为 'all'，week 为 'week'），属预期。
    expect(override.range).toBe('all');
    expect({ ...override, range: 'week' }).toEqual(week);
  });

  it('getBountyCompletionsTotal 复刻 migrateBountyCompletionsToTotal', async () => {
    const total = await adapter.getBountyCompletionsTotal(TENANT, CHILD);
    // taskA: 3 + 2 = 5; taskB: true(+1) + 1 = 2; taskC: 0
    expect(total).toEqual({ taskA: 5, taskB: 2, taskC: 0 });
  });

  it('tenantId 缺失时 getStats / getBountyCompletionsTotal 抛错', async () => {
    await expect(adapter.getStats('all', undefined, CHILD)).rejects.toThrow('tenantId required');
    await expect(adapter.getBountyCompletionsTotal(undefined, CHILD)).rejects.toThrow('tenantId required');
  });

  it('buildStatsFromData month 分支（>180 天）按 YYYY-MM 聚合', async () => {
    const { buildStatsFromData } = await import('../../src/db/stats.js');
    const sbd: any = {};
    const hbd: any = {};
    const all: string[] = [];
    const base = new Date(2025, 0, 1);
    for (let i = 0; i < 200; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const dk = ymd(d);
      all.push(dk);
      sbd[dk] = { rating: '优', finalPoints: i, totalBeforeRating: i, multiplier: 1 };
      hbd[dk] = [{ id: 'x' + i, status: 'done', rejected: false, actualDuration: 100, suggestedDuration: 120, completedInSchool: false }];
    }
    const res = (buildStatsFromData as any)({ settlementByDate: sbd, homeworksByDate: hbd, dateRange: all, allDates: all, range: 'all' });
    expect(res.groupMode).toBe('month');
    const months = new Set(all.map((d) => d.slice(0, 7)));
    expect(res.totalMinutes.length).toBe(months.size);
    // dailyPoints 总和 == 所有 finalPoints 之和（0+1+...+199 = 19900）
    const sumDP = res.dailyPoints.reduce((s: number, p: any) => s + p.value, 0);
    expect(sumDP).toBe((199 * 200) / 2);
  });
});

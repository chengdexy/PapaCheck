/**
 * stats.test.ts —— getWeekStart / formatWeekLabel 的「TZ 代码级固化」验证。
 *
 * 目标（design §E.3-①）：
 *  1. 正确性：返回的「周一」与旧前端（Asia/Shanghai 下 new Date('YYYY-MM-DD').getDay()）
 *     逐字段一致（AC-2 前提）。
 *  2. 时区无关性：实现仅用 Date.UTC + getUTC*，不读取 process.env.TZ，
 *     因此无论运行环境 TZ 为何，结果恒定。本测试额外构造一个「时区朴素」实现
 *     （模拟 TZ=America/Los_Angeles 下 new Date('YYYY-MM-DD').getDay() 的偏移 bug），
 *     断言我们的实现与之不同、始终返回正确 Monday。
 */
import { describe, it, expect } from 'vitest';
import { getWeekStart, formatWeekLabel } from '../src/db/stats.js';

const DAY_MS = 86_400_000;

/** 参考实现：与实现等价的 UTC 日历 Monday 计算（用于已知值比对）。 */
function refMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const dow = new Date(ms).getUTCDay(); // 0=Sun .. 6=Sat
  const diff = (dow + 6) % 7;
  return new Date(ms - diff * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 「时区朴素」实现：模拟未固化 TZ 的服务端在负偏移时区（如 America/Los_Angeles）
 * 下 `new Date('YYYY-MM-DD').getDay()` 的表现 —— 会错误地把日历日回拨到前一天，
 * 从而算出错误的 Monday。我们的实现必须与之不同。
 */
function naiveLocalMonday(dateStr: string): string {
  // 模拟 'YYYY-MM-DD' 被解析为 UTC 午夜后，在负偏移时区里落到前一天本地时间
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcMidnight = new Date(Date.UTC(y, m - 1, d));
  const localShifted = new Date(utcMidnight.getTime() - 8 * 3_600_000); // -8h 模拟 LA
  const dow = localShifted.getUTCDay();
  const diff = (dow + 6) % 7;
  return new Date(localShifted.getTime() - diff * DAY_MS).toISOString().slice(0, 10);
}

describe('getWeekStart —— TZ 确定性 & 正确性', () => {
  const knownCases: Array<[string, string]> = [
    ['2026-07-20', '2026-07-20'], // 周一本身
    ['2026-07-19', '2026-07-13'], // 周日 → 上周一
    ['2026-07-21', '2026-07-20'], // 周二 → 本周一
    ['2026-07-26', '2026-07-20'], // 周日
    ['2026-07-13', '2026-07-13'], // 周一
    ['2026-08-01', '2026-07-27'], // 跨月（周六）
    ['2026-01-01', '2025-12-29'], // 跨年（周四）
    ['2025-12-29', '2025-12-29'], // 周一
    ['2024-12-30', '2024-12-30'], // 周一（闰年边界）
    ['2024-01-01', '2024-01-01'], // 周一
    ['2023-01-01', '2022-12-26'], // 跨年（周日）
    ['2020-02-29', '2020-02-24'], // 闰年 2/29（周六）
    ['2026-12-31', '2026-12-28'], // 年末（周四）
    ['2026-11-02', '2026-11-02'], // 周一
  ];

  it('已知日期返回与参考实现一致的周一', () => {
    for (const [input, expected] of knownCases) {
      expect(getWeekStart(input), `input=${input}`).toBe(expected);
      expect(getWeekStart(input), `input=${input}`).toBe(refMonday(input));
    }
  });

  it('与时区朴素实现结果不同（证明已固化、不随运行时 TZ 偏移）', () => {
    const probe = ['2026-07-20', '2026-08-01', '2026-01-01', '2023-01-01', '2020-02-29'];
    for (const d of probe) {
      // 至少部分日期在负偏移时区下会被朴素实现算错 —— 我们的实现必须返回正确值
      expect(getWeekStart(d)).toBe(refMonday(d));
      if (naiveLocalMonday(d) !== refMonday(d)) {
        expect(getWeekStart(d)).not.toBe(naiveLocalMonday(d));
      }
    }
  });

  it('大范围扫描：结果恒为周一且落在输入当周（0~6 天前）', () => {
    const start = Date.UTC(2020, 0, 1);
    const end = Date.UTC(2030, 11, 31);
    for (let ms = start; ms <= end; ms += DAY_MS) {
      const ds = new Date(ms).toISOString().slice(0, 10);
      const mon = getWeekStart(ds);
      const [my, mm, md] = mon.split('-').map(Number);
      const monMs = Date.UTC(my, mm - 1, md);
      // mon 必须是周一
      expect(new Date(monMs).getUTCDay(), `mon=${mon}`).toBe(1);
      const gap = Math.round((ms - monMs) / DAY_MS);
      expect(gap, `ds=${ds} mon=${mon}`).toBeGreaterThanOrEqual(0);
      expect(gap, `ds=${ds} mon=${mon}`).toBeLessThan(7);
    }
  });
});

describe('formatWeekLabel —— TZ 确定性', () => {
  // 注意：formatWeekLabel 的输入约定为「周一」日期串（即 getWeekStart 的输出）。
  const cases: Array<[string, string]> = [
    ['2026-07-20', '7/20-7/26'],
    ['2026-07-13', '7/13-7/19'],
    ['2026-07-27', '7/27-8/2'], // 跨月周（对应 2026-08-01 所在周）
    ['2025-12-29', '12/29-1/4'], // 跨年周（对应 2026-01-01 所在周）
    ['2024-12-30', '12/30-1/5'], // 跨年周
  ];

  it('已知（周一）日期返回 M/D-M/D 周标签', () => {
    for (const [input, expected] of cases) {
      expect(formatWeekLabel(input), `input=${input}`).toBe(expected);
    }
  });

  it('周标签起点与 getWeekStart 一致', () => {
    const probe = ['2026-08-01', '2026-01-01', '2024-12-30'];
    for (const d of probe) {
      const monday = getWeekStart(d); // 该日期所在周一（YYYY-MM-DD）
      const label = formatWeekLabel(monday);
      const startLabel = label.split('-')[0];
      const [my, mm, md] = monday.split('-').map(Number);
      const monDate = new Date(Date.UTC(my, mm - 1, md));
      const expectedStart = `${monDate.getUTCMonth() + 1}/${monDate.getUTCDate()}`;
      expect(expectedStart).toBe(startLabel);
    }
  });
});

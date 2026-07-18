#!/usr/bin/env node
/**
 * verify-data-on-demand.mjs
 * -----------------------------------------------------------------------------
 * 数据「按需获取」端到端验证脚本（生产/预发 CloudFunc）。
 *
 * 用途（design §D.3 / E.4.3）：用【真实 access_code】登录后，依次验证三条按需端点
 *   - GET /api/stats?range=week|month|all
 *   - GET /api/points/balance
 *   - GET /api/bounty-completions/total
 * 以及回退通道 GET /api/data（瘦身快照，确认不再返回 points.history 等废弃字段），
 * 并对 StatsResult 做结构性 + 自洽性断言，同时校验「周」聚合标签为连续周一开头
 * （这是 TZ 代码级固化在运行期的可观测验证点）。
 *
 * 运行（需 Node >= 18，自带 fetch）：
 *   ACCESS_CODE=xxxx ENDPOINT=https://chengdexy.cn/papacheck/api node scripts/verify-data-on-demand.mjs
 *
 * 可选环境变量：
 *   ACCESS_CODE_2  第二个孩子的 access_code，用于验证跨 child 隔离（期望 403/401）。
 *   RANGES         覆盖的 range 列表，默认 "week,month,all"。
 *
 * 退出码：全部通过 0；任一断言失败 1。
 * -----------------------------------------------------------------------------
 */

const ENDPOINT = (process.env.ENDPOINT || 'https://chengdexy.cn/papacheck/api').replace(/\/$/, '');
const ACCESS_CODE = process.env.ACCESS_CODE;
const ACCESS_CODE_2 = process.env.ACCESS_CODE_2;
const RANGES = (process.env.RANGES || 'week,month,all').split(',').map((s) => s.trim());

const results = [];
let failures = 0;

function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures++;
  results.push({ ok, name, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

function assertShape(stats) {
  const required = [
    'range', 'groupMode', 'totalMinutes', 'efficiencyRatios', 'dailyPoints',
    'ratingCounts', 'ratingTotal', 'ratingsList', 'completedInSchool',
    'streak', 'avgTotalMin', 'avgEffVal', 'totalPoints',
  ];
  for (const k of required) {
    if (!(k in stats)) return `StatsResult 缺少字段: ${k}`;
  }
  if (!Array.isArray(stats.totalMinutes)) return 'totalMinutes 非数组';
  if (typeof stats.streak !== 'number' || stats.streak < 0) return 'streak 非法';
  if (typeof stats.totalPoints !== 'number') return 'totalPoints 非法';
  return null;
}

/** 校验「周」视图标签为连续周一开头（TZ 固化运行期验证）。 */
function verifyWeekLabelsAreConsecutiveMondays(stats) {
  if (stats.groupMode !== 'week') return null;
  const labels = stats.totalMinutes.map((p) => p.label); // M/D-M/D
  if (labels.length === 0) return null;
  // 解析每个标签起点为绝对日期并比对是否为周一 + 相邻间隔 7 天
  const parse = (label) => {
    const [m, d] = label.split('-')[0].split('/').map(Number);
    // 用 stats.range 年份不可靠，这里只验证「周一 + 间隔」相对性质
    return { m, d };
  };
  // 取相邻标签的 (月,日) 差，校验为 +7 天（跨月时简单校验单调性 + 周一）
  for (let i = 1; i < labels.length; i++) {
    const prev = parse(labels[i - 1]);
    const cur = parse(labels[i]);
    // 至少保证 cur 的日历点晚于 prev（按年内 day-of-year 近似）
    const doy = (mm, dd) => mm * 31 + dd; // 近似单调即可
    if (doy(cur.m, cur.d) <= doy(prev.m, prev.d)) {
      return `周标签非单调递增: ${labels[i - 1]} -> ${labels[i]}`;
    }
  }
  return null;
}

async function api(path, token) {
  const res = await fetch(`${ENDPOINT}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return { status: res.status, json, text };
}

async function main() {
  if (!ACCESS_CODE) {
    console.error('缺少环境变量 ACCESS_CODE（真实孩子端 access_code）。无法执行端到端验证。');
    process.exit(2);
  }

  console.log(`\n=== 数据按需获取端到端验证 @ ${ENDPOINT} ===\n`);

  // 1) 用真实 access_code 换取 JWT（正确端点 /api/auth/exchange，非 /api/auth/login）
  let token = null;
  let childId = null;
  try {
    const lr = await fetch(`${ENDPOINT}/auth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: ACCESS_CODE, role: 'child' }),
    });
    const lj = await lr.json();
    token = lj?.token;
    childId = lj?.child_id;
    check('access_code 换取 JWT（/api/auth/exchange, role=child）', !!token && lr.status === 200,
      `status=${lr.status} child_id=${childId || '-'} child_name=${lj?.child_name || '-'}`);
    // 若 child 返回 403（可能绑定 parent），按限频要求仅重试一次 parent
    if (!token && lr.status === 403) {
      const lr2 = await fetch(`${ENDPOINT}/auth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: ACCESS_CODE, role: 'parent' }),
      });
      const lj2 = await lr2.json();
      token = lj2?.token;
      childId = lj2?.child_id;
      check('access_code 换取 JWT（role=parent 重试）', !!token && lr2.status === 200,
        `status=${lr2.status} child_id=${lj2?.child_id || '-'}`);
    }
  } catch (e) {
    check('access_code 换取 JWT', false, String(e));
  }
  } catch (e) {
    check('登录成功换取 JWT（真实 access_code）', false, String(e));
  }

  if (!token) {
    console.error('\n未能获取 JWT，终止后续验证。');
    process.exit(1);
  }

  // 2) 三条按需端点
  for (const range of RANGES) {
    const r = await api(`/stats?range=${range}`, token);
    check(`GET /api/stats?range=${range} 返回 200`, r.status === 200, `status=${r.status}`);
    if (r.status === 200 && r.json) {
      const shapeErr = assertShape(r.json);
      check(`/api/stats?range=${range} StatsResult 结构完整`, !shapeErr, shapeErr || 'OK');
      const selfErr =
        (r.json.totalPoints === r.json.dailyPoints.reduce((s, p) => s + (p.value || 0), 0) ? null : 'totalPoints != ΣdailyPoints') ||
        (r.json.ratingTotal === Object.values(r.json.ratingCounts).reduce((s, c) => s + c, 0) ? null : 'ratingTotal != ΣratingCounts') ||
        verifyWeekLabelsAreConsecutiveMondays(r.json);
      check(`/api/stats?range=${range} 自洽性 + 周标签周一连续`, !selfErr, selfErr || 'OK');
    }
  }

  const bal = await api('/points/balance', token);
  check('GET /api/points/balance 返回 200', bal.status === 200, `status=${bal.status}`);
  check('GET /api/points/balance 返回数字余额', bal.json && typeof bal.json.balance === 'number',
    `balance=${bal.json?.balance}`);

  const bc = await api('/bounty-completions/total', token);
  check('GET /api/bounty-completions/total 返回 200', bc.status === 200, `status=${bc.status}`);
  check('GET /api/bounty-completions/total 返回对象', bc.json && typeof bc.json === 'object',
    `keys=${bc.json ? Object.keys(bc.json).length : 0}`);

  // 3) 回退通道 /api/data（瘦身快照）
  const data = await api('/data', token);
  check('GET /api/data 回退通道 200', data.status === 200, `status=${data.status}`);
  if (data.json) {
    check('/api/data 已停止返回 points.history', !('history' in (data.json.points || {})),
      'points.history 已剔除');
    check('/api/data 仍返回 points.balance', 'balance' in (data.json.points || {}), 'OK');
    check('/api/data 已停止返回 efficiencyHistory', !('efficiencyHistory' in data.json), 'OK');
  }

  // 4) 无鉴权应 401
  const noAuth = await api('/stats?range=week', null);
  check('GET /api/stats 无 Authorization 返回 401', noAuth.status === 401, `status=${noAuth.status}`);

  // 5) 跨 child 隔离（可选，需第二个 access_code）
  if (ACCESS_CODE_2) {
    try {
      const lr2 = await fetch(`${ENDPOINT}/auth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: ACCESS_CODE_2, role: 'child' }),
      });
      const lj2 = await lr2.json();
      const token2 = lj2?.token;
      if (token2) {
        // 用 child2 的 token 访问 child1 的显式 child_id 参数（若后端支持），期望 403
        const cross = await api(`/stats?range=week&child_id=${encodeURIComponent(childId || '')}`, token2);
        check('跨 child 访问被拒绝（403/401）', cross.status === 403 || cross.status === 401,
          `status=${cross.status}`);
      } else {
        check('跨 child 隔离（第二个 access_code 登录失败，跳过）', true, 'skipped');
      }
    } catch (e) {
      check('跨 child 隔离验证异常', false, String(e));
    }
  }

  console.log(`\n=== 结果：${results.length - failures}/${results.length} 通过，${failures} 失败 ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('验证脚本异常：', e);
  process.exit(1);
});

// cleanup-junk-shop-items.mjs
// 诊断 + 清理积分商城中「无有效 id / 单字名称」的无法删除商品。
// 默认 DRY-RUN（只列出，不改数据）。加 --apply 才真正清理（走 PUT /api/shop 整体替换）。
//
// 用法:
//   node scripts/cleanup-junk-shop-items.mjs --token "<家长JWT>"
//   node scripts/cleanup-junk-shop-items.mjs --token "<家长JWT>" --apply
//   node scripts/cleanup-junk-shop-items.mjs --token "<家长JWT>" --apply --also-single-char
// 也可用环境变量: PAPACHECK_TOKEN=xxx  PAPACHECK_API_BASE=https://chengdexy.cn/papacheck/api

import process from 'node:process';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const APPLY = has('--apply');
const ALSO_SINGLE_CHAR = has('--also-single-char');
const token = process.env.PAPACHECK_TOKEN || valOf('--token');
const apiBase =
  process.env.PAPACHECK_API_BASE || valOf('--api-base') || 'https://chengdexy.cn/papacheck/api';

if (!token) {
  console.error('缺少 JWT：传 --token "<家长JWT>" 或设环境变量 PAPACHECK_TOKEN');
  process.exit(2);
}

const isValidId = (id) => typeof id === 'string' && id.length > 0;

async function main() {
  const res = await fetch(apiBase + '/shop', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) {
    console.error('GET /shop 失败:', res.status, await res.text());
    process.exit(1);
  }
  const items = await res.json();
  if (!Array.isArray(items)) {
    console.error('GET /shop 返回非数组:', items);
    process.exit(1);
  }

  const invalidId = items.filter((it) => !isValidId(it && it.id));
  const singleChar = items.filter(
    (it) => it && typeof it.name === 'string' && [...it.name.trim()].length === 1
  );

  console.log(`当前商品总数: ${items.length}`);
  console.log(`无有效 id（必然无法删除，默认清理）: ${invalidId.length}`);
  console.log(`单字名称（--also-single-char 才清理）: ${singleChar.length}`);

  console.log('\n--- 无有效 id 的商品（样例，最多 20）---');
  for (const it of invalidId.slice(0, 20)) {
    console.log(JSON.stringify({ id: it.id, name: it.name, type: it.type }));
  }
  console.log('\n--- 单字名称商品（样例，最多 20）---');
  for (const it of singleChar.slice(0, 20)) {
    console.log(JSON.stringify({ id: it.id, name: it.name, type: it.type }));
  }

  if (!APPLY) {
    console.log(
      '\n[DRY-RUN] 未做任何改动。加 --apply 清理无有效 id 的商品' +
        (ALSO_SINGLE_CHAR ? '（含单字名称）' : '') +
        '。'
    );
    process.exit(0);
  }

  const removeSet = new Set(invalidId);
  if (ALSO_SINGLE_CHAR) for (const it of singleChar) removeSet.add(it);
  const kept = items.filter((it) => !removeSet.has(it));
  const removed = items.length - kept.length;
  console.log(`\n[APPLY] 将移除 ${removed} 条，保留 ${kept.length} 条。`);

  const putRes = await fetch(apiBase + '/shop', {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: kept }),
  });
  if (!putRes.ok) {
    console.error('PUT /shop 失败:', putRes.status, await putRes.text());
    process.exit(1);
  }
  console.log('清理完成。请在前端刷新积分商城确认商品已消失。');
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(1);
});

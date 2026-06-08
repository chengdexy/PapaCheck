const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.argv[2] || 'C:/Users/Admin/AppData/Local/PapaCheck/Server/data.db';
const outputPath = process.argv[3] || path.join(__dirname, 'review-data.json');

const db = new Database(dbPath, { readonly: true });

// Helper: CST conversion (UTC+8)
function toCST(isoStr) {
  const d = new Date(isoStr);
  d.setTime(d.getTime() + 8 * 60 * 60 * 1000);
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    timeStr: String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0')
  };
}

// Load all homework data
const allHwRows = db.prepare('SELECT date_key, data FROM homeworks').all();
let allItems = [];
allHwRows.forEach(r => {
  const data = JSON.parse(r.data);
  data.forEach(h => { allItems.push({ ...h, date: r.date_key }); });
});

const doneItems = allItems.filter(h => h.status === 'done');
const withEfficiency = doneItems.filter(h => h.actualDuration && h.suggestedDuration);

// === 2. 坚持 ===
const dates = [...new Set(allItems.map(h => h.date))].sort();
const subjCount = {};
doneItems.forEach(h => { subjCount[h.subject] = (subjCount[h.subject] || 0) + 1; });

// === 3. 时间投入 ===
const totalActualMin = doneItems.reduce((s, h) => s + (h.actualDuration || 0), 0);
const totalSuggestedMin = doneItems.reduce((s, h) => s + (h.suggestedDuration || 0), 0);

// === 4. 效率 ===
const fasterCount = withEfficiency.filter(h => h.actualDuration <= h.suggestedDuration).length;
const fasterPct = Math.round(fasterCount / withEfficiency.length * 100);
const avgPct = Math.round(withEfficiency.reduce((s, h) => s + h.actualDuration / h.suggestedDuration, 0) / withEfficiency.length * 100);

// Subject efficiency (suggested/actual, higher = faster)
const subjEff = {};
withEfficiency.forEach(h => {
  if (!subjEff[h.subject]) subjEff[h.subject] = [];
  subjEff[h.subject].push(h.suggestedDuration / h.actualDuration);
});
const subjEffAvg = {};
Object.keys(subjEff).forEach(s => {
  subjEffAvg[s] = (subjEff[s].reduce((a, b) => a + b, 0) / subjEff[s].length).toFixed(2);
});

// === 5. 效率高光日 ===
const dailyEff = {};
const effRows = db.prepare('SELECT * FROM efficiency_history').all();
let bestEffDay = null, bestEffVal = 0;
effRows.forEach(r => {
  const d = JSON.parse(r.data);
  if (d.averageRatio > bestEffVal) {
    bestEffVal = d.averageRatio;
    bestEffDay = r.date_key;
  }
});

// === 6. 最拼一天 ===
const dailyCount = {};
allItems.forEach(h => { dailyCount[h.date] = (dailyCount[h.date] || 0) + 1; });
const busiestDay = Object.entries(dailyCount).sort((a, b) => b[1] - a[1])[0];

// === 7. 深夜战士 (latest complete per day, CST) ===
let latestDay = null, latestTime = '', latestContent = '', latestMins = 0;
doneItems.forEach(h => {
  if (!h.completedAt) return;
  const cst = toCST(h.completedAt);
  if (cst.hour * 60 + cst.minute > latestMins) {
    latestMins = cst.hour * 60 + cst.minute;
    latestDay = h.date;
    latestTime = cst.timeStr;
    latestContent = h.content;
  }
});

// === 8. 早起鸟儿 (earliest start per day, CST) ===
let earliestDay = null, earliestTime = '', earliestContent = '', earliestMins = 24 * 60;
doneItems.forEach(h => {
  if (!h.startedAt) return;
  const cst = toCST(h.startedAt);
  if (cst.hour * 60 + cst.minute < earliestMins) {
    earliestMins = cst.hour * 60 + cst.minute;
    earliestDay = h.date;
    earliestTime = cst.timeStr;
    earliestContent = h.content;
  }
});

// === 9. 挑战精神 ===
const modeCount = {};
doneItems.forEach(h => { modeCount[h.mode] = (modeCount[h.mode] || 0) + 1; });

// === 10. 评级 ===
const settlements = db.prepare('SELECT * FROM daily_settlement').all();
const ratingCount = { '优': 0, '良': 0, '可': 0, '差': 0 };
settlements.forEach(r => {
  const d = JSON.parse(r.data);
  if (d.rating) ratingCount[d.rating] = (ratingCount[d.rating] || 0) + 1;
});
const totalRated = Object.values(ratingCount).reduce((a, b) => a + b, 0);
const excellentPct = Math.round(ratingCount['优'] / totalRated * 100);

// === 11. 积分 ===
const ph = db.prepare('SELECT * FROM points_history').all();
let hwEarned = 0, bountyEarned = 0;
ph.forEach(p => {
  const detail = p.detail || '';
  if (p.earned) {
    if (detail.includes('完成作业') || detail.includes('评级')) hwEarned += p.earned;
    else if (detail.includes('赏金')) bountyEarned += p.earned;
    else if (detail.includes('调整')) { /* skip adjustments */ }
    else bountyEarned += p.earned;
  }
});
const currentBalance = db.prepare('SELECT balance FROM points').get().balance;

// Max single day points
const dayPoints = {};
settlements.forEach(r => {
  const d = JSON.parse(r.data);
  if (d.finalPoints) dayPoints[r.date_key] = d.finalPoints;
});
const maxPointsDay = Object.entries(dayPoints).sort((a, b) => b[1] - a[1])[0];

// === 12. 自由时间 ===
const ftRows = db.prepare('SELECT * FROM free_time_tasks').all();
let totalFTTasks = 0, totalFTMinutes = 0;
ftRows.forEach(r => {
  const tasks = JSON.parse(r.data);
  tasks.forEach(t => { totalFTTasks++; totalFTMinutes += (t.durationMinutes || 0); });
});

// === 13. 兑换榜 ===
const redemptions = db.prepare('SELECT * FROM redemptions').all();
const itemCount = {};
if (redemptions.length > 0) {
  const rdData = JSON.parse(redemptions[0].data);
  rdData.filter(r => r.status === 'fulfilled').forEach(r => {
    itemCount[r.itemName] = (itemCount[r.itemName] || 0) + 1;
  });
}
const topRedemptions = Object.entries(itemCount).sort((a, b) => b[1] - a[1]).slice(0, 3);

// === 14. 赏金 ===
const bcRows = db.prepare('SELECT * FROM bounty_completions').all();
const btRows = db.prepare('SELECT * FROM bounty_tasks').all();
let totalBounty = 0;
let bountyDetails = [];
if (btRows.length > 0 && bcRows.length > 0) {
  const tasks = JSON.parse(btRows[0].data);
  const taskMap = {};
  tasks.forEach(t => { taskMap[t.id] = t; });
  const completions = JSON.parse(bcRows[0].data);
  Object.entries(completions).forEach(([id, count]) => {
    if (['uuid', 'lastModified', 'isDeleted'].includes(id)) return;
    if (typeof count !== 'number') return;
    const name = taskMap[id] ? taskMap[id].name : id;
    totalBounty += count;
    bountyDetails.push({ name, count });
  });
}
bountyDetails.sort((a, b) => b.count - a.count);

// Build output
const data = {
  meta: {
    generatedAt: new Date().toISOString(),
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    totalDays: dates.length
  },
  persistence: {
    totalItems: allItems.length,
    doneItems: doneItems.length,
    totalDays: dates.length,
    subjects: subjCount
  },
  time: {
    totalHours: (totalActualMin / 60).toFixed(1),
    totalMin: totalActualMin,
    dailyAvgMin: Math.round(totalActualMin / dates.length),
    perItemAvgMin: Math.round(totalActualMin / doneItems.length)
  },
  efficiency: {
    fasterPct,
    avgPct,
    subjects: subjEffAvg
  },
  efficiencyHighlight: {
    date: bestEffDay,
    value: bestEffVal.toFixed(2),
    display: bestEffVal.toFixed(2) + 'x'
  },
  busiestDay: {
    date: busiestDay[0],
    count: busiestDay[1]
  },
  latestDay: {
    date: latestDay,
    time: latestTime,
    content: latestContent
  },
  earliestDay: {
    date: earliestDay,
    time: earliestTime,
    content: earliestContent
  },
  challenge: {
    challengeCount: modeCount['challenge'] || 0,
    timerCount: modeCount['timer'] || 0
  },
  rating: {
    excellentPct,
    excellent: ratingCount['优'],
    good: ratingCount['良'],
    fair: ratingCount['可'],
    poor: ratingCount['差'],
    total: totalRated
  },
  points: {
    hwEarned,
    bountyEarned,
    currentBalance,
    maxSingleDay: maxPointsDay ? { date: maxPointsDay[0], points: maxPointsDay[1] } : null
  },
  freeTime: {
    totalHours: (totalFTMinutes / 60).toFixed(1),
    totalMin: totalFTMinutes,
    totalTasks: totalFTTasks
  },
  topRedemptions: topRedemptions.map(([name, count]) => ({ name, count })),
  bounty: {
    total: totalBounty,
    totalPoints: bountyEarned,
    details: bountyDetails
  }
};

fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
console.log('Data written to: ' + outputPath);
console.log(JSON.stringify(data, null, 2));

db.close();

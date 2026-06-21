/**
 * 将 UTC ISO 时间字符串格式化为东八区友好显示
 * 例: "2026-06-15T05:09:42.197Z" → "2026/6/15 13:09:42"
 */
export function formatLocalTime(isoString: string): string {
  const d = new Date(isoString);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

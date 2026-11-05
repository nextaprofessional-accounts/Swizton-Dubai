export function businessDate(instant = new Date().toISOString()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Calcutta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  return ['year', 'month', 'day'].map((k) => parts.find((p) => p.type === k)!.value).join('-');
}
export function monthRange(start: string, count: number) {
  const y = Number(start.slice(0, 4)),
    m = Number(start.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, i) => {
    const n = y * 12 + m + i;
    return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
  });
}
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);

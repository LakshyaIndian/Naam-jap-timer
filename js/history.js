function pad(v){ return String(v).padStart(2, "0"); }
export function getLocalDateKey(date = new Date()) { return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
export function ensureDateRollover(state, now = new Date()) {
  const key = getLocalDateKey(now);
  if (state.currentDate !== key) state.currentDate = key;
  if (!Number.isFinite(state.history[key])) state.history[key] = 0;
  return key;
}
export function incrementTodayCount(state){ const key = ensureDateRollover(state); state.history[key] = (state.history[key] || 0) + 1; return state.history[key]; }
export function resetTodayCount(state){ const key = ensureDateRollover(state); state.history[key] = 0; }
export function getStats(history, now = new Date()) {
  const todayKey = getLocalDateKey(now); const m = `${now.getFullYear()}-${pad(now.getMonth()+1)}`; const y = String(now.getFullYear());
  let allTime = 0, month = 0, year = 0;
  for (const [k, c] of Object.entries(history)) { allTime += c; if (k.startsWith(m)) month += c; if (k.startsWith(y)) year += c; }
  return { today: history[todayKey] || 0, month, year, allTime };
}
export function getGroupedHistory(history){
  const entries = Object.entries(history).filter(([,c])=>Number.isFinite(c)).sort((a,b)=>b[0].localeCompare(a[0]));
  const groups = new Map();
  for (const [key,count] of entries){
    const [year,month,day] = key.split("-").map(Number);
    const groupKey = `${year}-${String(month).padStart(2,"0")}`;
    if (!groups.has(groupKey)) groups.set(groupKey,{ key:groupKey, title:new Date(year,month-1,day).toLocaleDateString(undefined,{month:"long",year:"numeric"}), total:0, items:[] });
    const group = groups.get(groupKey); group.total += count;
    group.items.push({ dateKey:key, count, dateLabel:new Date(year,month-1,day).toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short",year:"numeric"}), subLabel:`${String(day).padStart(2,"0")}/${String(month).padStart(2,"0")}/${year}` });
  }
  return Array.from(groups.values());
}
export function mergeHistory(targetHistory,incomingHistory){ for (const [k,v] of Object.entries(incomingHistory)) targetHistory[k] = (targetHistory[k] || 0) + v; }

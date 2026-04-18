const STORAGE_KEY = "harivansh-mala-state-v1";
const defaults = () => ({
  version: 1,
  currentDate: "",
  history: {},
  theme: "deep-maroon-devotional",
  settings: { sound: true, vibration: true, confirmReset: true, showStatsOnHome: true, wakeLock: false },
  timer: { phase: "idle", startedAt: null, endAt: null, pausedRemainingMs: null, completionHandled: false, completionDecisionMade: false }
});
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
function sanitizeHistory(history) {
  const safe = {};
  if (!isObj(history)) return safe;
  for (const [k, v] of Object.entries(history)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(v) && v >= 0) safe[k] = Math.floor(v);
  }
  return safe;
}
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    const d = defaults();
    return {
      version: 1,
      currentDate: typeof parsed.currentDate === "string" ? parsed.currentDate : "",
      history: sanitizeHistory(parsed.history),
      theme: typeof parsed.theme === "string" ? parsed.theme : d.theme,
      settings: { ...d.settings, ...(isObj(parsed.settings) ? parsed.settings : {}) },
      timer: { ...d.timer, ...(isObj(parsed.timer) ? parsed.timer : {}) }
    };
  } catch { return defaults(); }
}
export function saveState(state) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} }
export function resetStoredState() { try { localStorage.removeItem(STORAGE_KEY); } catch {} }
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
export function parseImportedState(text) {
  const parsed = JSON.parse(text);
  const history = sanitizeHistory(parsed.history ?? parsed);
  if (!Object.keys(history).length) throw new Error("Backup file does not contain valid mala history.");
  return { version: 1, history };
}

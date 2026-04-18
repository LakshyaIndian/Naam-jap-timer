import { loadState, saveState, resetStoredState, downloadJson, parseImportedState } from "./storage.js";
import { ensureDateRollover, incrementTodayCount, resetTodayCount, getStats, getGroupedHistory, mergeHistory, getLocalDateKey } from "./history.js";
import { isValidTheme, applyTheme } from "./themes.js";
import { createTimerApi } from "./timer.js";
import { createUi } from "./ui.js";

const state = loadState();
const timer = createTimerApi(state);
const ui = createUi();
let deferredInstallPrompt = null;
let audioContext = null;
let wakeLock = null;
let completionInFlight = false;

const persist = () => saveState(state);

function formatTodayLabel(){ return new Date().toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short",year:"numeric"}); }
function applySavedTheme(){ if (!isValidTheme(state.theme)) state.theme = "deep-maroon-devotional"; applyTheme(state.theme); }
async function requestWakeLockIfNeeded(){ if (!state.settings.wakeLock || state.timer.phase !== "running" || !("wakeLock" in navigator)) return; try { wakeLock = await navigator.wakeLock.request("screen"); } catch { wakeLock = null; } }
async function releaseWakeLock(){ try { if (wakeLock) await wakeLock.release(); } catch {} finally { wakeLock = null; } }
function reconcileDateAndTimer(){ ensureDateRollover(state); timer.recoverCompletion(Date.now()); }
function updateUi(){
  reconcileDateAndTimer();
  const stats = getStats(state.history);
  ui.renderTimer({ phase:state.timer.phase, remainingMs:timer.getRemainingMs(Date.now()), progress:timer.getProgress(Date.now()) });
  ui.renderStats({ ...stats, todayLabel:formatTodayLabel(), showStatsOnHome:state.settings.showStatsOnHome });
  ui.renderHistorySummary(stats);
  ui.renderHistoryGroups(getGroupedHistory(state.history));
  ui.renderThemes(state.theme, handleThemeChange);
  ui.renderSettings(state.settings);
  if (state.timer.phase === "completed-awaiting-decision" && !state.timer.completionHandled) handleCompletionEffects();
  persist();
}
function handleThemeChange(id){ if (!isValidTheme(id)) return; state.theme=id; applyTheme(state.theme); ui.setSettingsMessage(`Theme changed to ${ui.getThemeName(id)}.`); updateUi(); }
async function playCompletionSound(){
  if (!state.settings.sound) return;
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") await audioContext.resume();
    const now = audioContext.currentTime, osc = audioContext.createOscillator(), gain = audioContext.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(528, now); osc.frequency.exponentialRampToValueAtTime(432, now + 0.65);
    gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    osc.connect(gain); gain.connect(audioContext.destination); osc.start(now); osc.stop(now + 0.78);
  } catch {}
}
function vibrateCompletion(){ if (state.settings.vibration && "vibrate" in navigator) { try { navigator.vibrate([120,60,120]); } catch {} } }
function handleCompletionEffects(){ state.timer.completionHandled = true; playCompletionSound(); vibrateCompletion(); ui.showCompletionDialog(state.timer.completionDecisionMade); releaseWakeLock(); persist(); }
function handleCountDecision(shouldCount){
  if (completionInFlight || state.timer.completionDecisionMade) return;
  completionInFlight = true;
  if (shouldCount){ state.timer.completionDecisionMade = true; ui.elements.countYesButton.disabled = true; incrementTodayCount(state); }
  timer.setIdle(); completionInFlight = false; ui.closeCompletionDialog(); updateUi();
}
function bindEvents(){
  ui.bindNavigation();
  ui.elements.startButton.addEventListener("click", async()=>{ ensureDateRollover(state); timer.start(); await requestWakeLockIfNeeded(); updateUi(); });
  ui.elements.pauseButton.addEventListener("click", async()=>{ timer.pause(); await releaseWakeLock(); updateUi(); });
  ui.elements.resumeButton.addEventListener("click", async()=>{ timer.resume(); await requestWakeLockIfNeeded(); updateUi(); });
  ui.elements.resetButton.addEventListener("click", async()=>{ if (state.settings.confirmReset && !window.confirm("Reset the current 8-minute timer?")) return; timer.reset(); await releaseWakeLock(); updateUi(); });
  ui.elements.countYesButton.addEventListener("click", (e)=>{ e.preventDefault(); handleCountDecision(true); });
  ui.elements.countNoButton.addEventListener("click", (e)=>{ e.preventDefault(); handleCountDecision(false); });
  ui.elements.completionDialog.addEventListener("cancel", (e)=>{ if (state.timer.phase === "completed-awaiting-decision") e.preventDefault(); });
  document.getElementById("export-button").addEventListener("click", ()=>{ downloadJson(`harivansh-mala-backup-${getLocalDateKey()}.json`, { version:state.version, exportedAt:new Date().toISOString(), history:state.history }); ui.setSettingsMessage("Backup exported."); });
  document.getElementById("import-button").addEventListener("click", ()=>document.getElementById("import-file").click());
  document.getElementById("import-file").addEventListener("change", async(e)=>{ const [file] = e.target.files || []; e.target.value=""; if (!file) return; try { const imported = parseImportedState(await file.text()); mergeHistory(state.history, imported.history); ensureDateRollover(state); ui.setSettingsMessage("Backup imported successfully."); updateUi(); } catch (err) { ui.setSettingsMessage(err instanceof Error ? err.message : "Import failed."); } });
  document.getElementById("reset-today-button").addEventListener("click", ()=>{ if (state.settings.confirmReset && !window.confirm("Reset today's mala count?")) return; resetTodayCount(state); ui.setSettingsMessage("Today's count has been reset."); updateUi(); });
  document.getElementById("reset-all-button").addEventListener("click", async()=>{ if (!window.confirm("Reset all mala data, history, and timer state? This cannot be undone.")) return; resetStoredState(); Object.assign(state, loadState()); timer.setIdle(); await releaseWakeLock(); applySavedTheme(); ui.setSettingsMessage("All data has been reset."); updateUi(); });
  document.getElementById("setting-sound").addEventListener("change", (e)=>{ state.settings.sound = e.target.checked; persist(); });
  document.getElementById("setting-vibration").addEventListener("change", (e)=>{ state.settings.vibration = e.target.checked; persist(); });
  document.getElementById("setting-confirm-reset").addEventListener("change", (e)=>{ state.settings.confirmReset = e.target.checked; persist(); });
  document.getElementById("setting-show-stats-home").addEventListener("change", (e)=>{ state.settings.showStatsOnHome = e.target.checked; updateUi(); });
  document.getElementById("setting-wake-lock").addEventListener("change", async(e)=>{ state.settings.wakeLock = e.target.checked; if (!state.settings.wakeLock) await releaseWakeLock(); else await requestWakeLockIfNeeded(); persist(); });
  window.addEventListener("beforeinstallprompt", (e)=>{ e.preventDefault(); deferredInstallPrompt = e; ui.elements.installButton.hidden = false; });
  ui.elements.installButton.addEventListener("click", async()=>{ if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); try { await deferredInstallPrompt.userChoice; } catch {} deferredInstallPrompt = null; ui.elements.installButton.hidden = true; });
  document.addEventListener("visibilitychange", async()=>{ if (document.visibilityState === "visible"){ reconcileDateAndTimer(); await requestWakeLockIfNeeded(); updateUi(); } else { persist(); } });
  window.addEventListener("focus", ()=>{ reconcileDateAndTimer(); updateUi(); });
  window.addEventListener("pageshow", ()=>{ reconcileDateAndTimer(); updateUi(); });
  if ("serviceWorker" in navigator) window.addEventListener("load", ()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
function animationLoop(){ updateUi(); requestAnimationFrame(animationLoop); }
ensureDateRollover(state); applySavedTheme(); bindEvents(); updateUi(); animationLoop();

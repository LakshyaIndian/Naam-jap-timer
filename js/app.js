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
let animationFrameId = null;
let timerUiLastSecond = null;
let timerUiLastPhase = null;
let lastDayKey = "";
let hasRenderedThemeGrid = false;

const persist = () => saveState(state);

function formatTodayLabel() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function applySavedTheme() {
  if (!isValidTheme(state.theme)) {
    state.theme = "deep-maroon-devotional";
  }
  applyTheme(state.theme);
}

async function requestWakeLockIfNeeded() {
  if (!state.settings.wakeLock || state.timer.phase !== "running" || !("wakeLock" in navigator)) {
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}

async function releaseWakeLock() {
  try {
    if (wakeLock) {
      await wakeLock.release();
    }
  } catch {
    // no-op
  } finally {
    wakeLock = null;
  }
}

function ensureFreshState() {
  const previousDayKey = state.currentDate;
  const currentDayKey = ensureDateRollover(state);
  const timerJustCompleted = timer.recoverCompletion(Date.now());
  const dayChanged = previousDayKey !== currentDayKey;
  lastDayKey = currentDayKey;
  return { dayChanged, timerJustCompleted };
}

function renderTimerUi(force = false) {
  const phase = state.timer.phase;
  const remainingMs = timer.getRemainingMs(Date.now());
  const displaySecond = Math.ceil(remainingMs / 1000);

  if (!force && phase === timerUiLastPhase && displaySecond === timerUiLastSecond) {
    return;
  }

  ui.renderTimer({
    phase,
    remainingMs,
    progress: timer.getProgress(Date.now())
  });

  timerUiLastPhase = phase;
  timerUiLastSecond = displaySecond;
}

function renderStaticUi(forceThemes = false) {
  const stats = getStats(state.history);

  ui.renderStats({
    ...stats,
    todayLabel: formatTodayLabel(),
    showStatsOnHome: state.settings.showStatsOnHome
  });
  ui.renderHistorySummary(stats);
  ui.renderHistoryGroups(getGroupedHistory(state.history));
  ui.renderSettings(state.settings);

  if (!hasRenderedThemeGrid || forceThemes) {
    ui.renderThemes(state.theme, handleThemeChange);
    hasRenderedThemeGrid = true;
  }
}

function syncUi({ forceTimer = false, forceStatic = false, forceThemes = false } = {}) {
  const { dayChanged, timerJustCompleted } = ensureFreshState();

  renderTimerUi(forceTimer || dayChanged || timerJustCompleted);

  if (forceStatic || dayChanged || lastDayKey !== state.currentDate) {
    renderStaticUi(forceThemes);
  }

  if (state.timer.phase === "completed-awaiting-decision" && !state.timer.completionHandled) {
    handleCompletionEffects();
  }
}

function commitState(options = {}) {
  persist();
  syncUi(options);
}

function startTimerLoop() {
  if (animationFrameId !== null) {
    return;
  }

  const tick = () => {
    animationFrameId = null;
    syncUi({ forceTimer: false, forceStatic: false });

    if (state.timer.phase === "running") {
      animationFrameId = requestAnimationFrame(tick);
    }
  };

  animationFrameId = requestAnimationFrame(tick);
}

function stopTimerLoop() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function refreshLoopForPhase() {
  if (state.timer.phase === "running") {
    startTimerLoop();
  } else {
    stopTimerLoop();
    syncUi({ forceTimer: true, forceStatic: false });
  }
}

function handleThemeChange(id) {
  if (!isValidTheme(id)) {
    return;
  }

  state.theme = id;
  applyTheme(state.theme);
  ui.setSettingsMessage(`Theme changed to ${ui.getThemeName(id)}.`);
  commitState({ forceTimer: true, forceStatic: true, forceThemes: true });
}

async function playCompletionSound() {
  if (!state.settings.sound) {
    return;
  }

  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(528, now);
    oscillator.frequency.exponentialRampToValueAtTime(432, now + 0.65);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.78);
  } catch {
    // fail silently on autoplay/audio restrictions
  }
}

function vibrateCompletion() {
  if (state.settings.vibration && "vibrate" in navigator) {
    try {
      navigator.vibrate([120, 60, 120]);
    } catch {
      // no-op
    }
  }
}

function handleCompletionEffects() {
  state.timer.completionHandled = true;
  playCompletionSound();
  vibrateCompletion();
  ui.showCompletionDialog(state.timer.completionDecisionMade);
  releaseWakeLock();
  persist();
}

function handleCountDecision(shouldCount) {
  if (completionInFlight || state.timer.completionDecisionMade) {
    return;
  }

  completionInFlight = true;

  if (shouldCount) {
    state.timer.completionDecisionMade = true;
    ui.elements.countYesButton.disabled = true;
    incrementTodayCount(state);
  }

  timer.setIdle();
  completionInFlight = false;
  ui.closeCompletionDialog();
  refreshLoopForPhase();
  commitState({ forceTimer: true, forceStatic: true });
}

function bindEvents() {
  ui.bindNavigation();

  ui.elements.startButton.addEventListener("click", async () => {
    ensureDateRollover(state);
    timer.start();
    await requestWakeLockIfNeeded();
    refreshLoopForPhase();
    commitState({ forceTimer: true, forceStatic: true });
  });

  ui.elements.pauseButton.addEventListener("click", async () => {
    timer.pause();
    await releaseWakeLock();
    refreshLoopForPhase();
    commitState({ forceTimer: true, forceStatic: false });
  });

  ui.elements.resumeButton.addEventListener("click", async () => {
    timer.resume();
    await requestWakeLockIfNeeded();
    refreshLoopForPhase();
    commitState({ forceTimer: true, forceStatic: false });
  });

  ui.elements.resetButton.addEventListener("click", async () => {
    if (state.settings.confirmReset && !window.confirm("Reset the current 8-minute timer?")) {
      return;
    }

    timer.reset();
    await releaseWakeLock();
    refreshLoopForPhase();
    commitState({ forceTimer: true, forceStatic: false });
  });

  ui.elements.countYesButton.addEventListener("click", (event) => {
    event.preventDefault();
    handleCountDecision(true);
  });

  ui.elements.countNoButton.addEventListener("click", (event) => {
    event.preventDefault();
    handleCountDecision(false);
  });

  ui.elements.completionDialog.addEventListener("cancel", (event) => {
    if (state.timer.phase === "completed-awaiting-decision") {
      event.preventDefault();
    }
  });

  document.getElementById("export-button").addEventListener("click", () => {
    downloadJson(`harivansh-mala-backup-${getLocalDateKey()}.json`, {
      version: state.version,
      exportedAt: new Date().toISOString(),
      history: state.history
    });
    ui.setSettingsMessage("Backup exported.");
  });

  document.getElementById("import-button").addEventListener("click", () => {
    document.getElementById("import-file").click();
  });

  document.getElementById("import-file").addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const imported = parseImportedState(await file.text());
      mergeHistory(state.history, imported.history);
      ensureDateRollover(state);
      ui.setSettingsMessage("Backup imported successfully.");
      commitState({ forceTimer: true, forceStatic: true });
    } catch (error) {
      ui.setSettingsMessage(error instanceof Error ? error.message : "Import failed.");
    }
  });

  document.getElementById("reset-today-button").addEventListener("click", () => {
    if (state.settings.confirmReset && !window.confirm("Reset today's mala count?")) {
      return;
    }

    resetTodayCount(state);
    ui.setSettingsMessage("Today's count has been reset.");
    commitState({ forceTimer: false, forceStatic: true });
  });

  document.getElementById("reset-all-button").addEventListener("click", async () => {
    if (!window.confirm("Reset all mala data, history, and timer state? This cannot be undone.")) {
      return;
    }

    resetStoredState();
    Object.assign(state, loadState());
    timer.setIdle();
    await releaseWakeLock();
    applySavedTheme();
    hasRenderedThemeGrid = false;
    ui.setSettingsMessage("All data has been reset.");
    refreshLoopForPhase();
    commitState({ forceTimer: true, forceStatic: true, forceThemes: true });
  });

  document.getElementById("setting-sound").addEventListener("change", (event) => {
    state.settings.sound = event.target.checked;
    persist();
  });

  document.getElementById("setting-vibration").addEventListener("change", (event) => {
    state.settings.vibration = event.target.checked;
    persist();
  });

  document.getElementById("setting-confirm-reset").addEventListener("change", (event) => {
    state.settings.confirmReset = event.target.checked;
    persist();
  });

  document.getElementById("setting-show-stats-home").addEventListener("change", (event) => {
    state.settings.showStatsOnHome = event.target.checked;
    commitState({ forceTimer: false, forceStatic: true });
  });

  document.getElementById("setting-wake-lock").addEventListener("change", async (event) => {
    state.settings.wakeLock = event.target.checked;

    if (!state.settings.wakeLock) {
      await releaseWakeLock();
    } else {
      await requestWakeLockIfNeeded();
    }

    persist();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    ui.elements.installButton.hidden = false;
  });

  ui.elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      return;
    }

    deferredInstallPrompt.prompt();

    try {
      await deferredInstallPrompt.userChoice;
    } catch {
      // no-op
    }

    deferredInstallPrompt = null;
    ui.elements.installButton.hidden = true;
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      const result = ensureFreshState();
      if (result.dayChanged || result.timerJustCompleted) {
        commitState({ forceTimer: true, forceStatic: true });
      } else {
        syncUi({ forceTimer: true, forceStatic: false });
      }
      await requestWakeLockIfNeeded();
      refreshLoopForPhase();
    } else {
      persist();
      stopTimerLoop();
    }
  });

  window.addEventListener("focus", async () => {
    const result = ensureFreshState();
    if (result.dayChanged || result.timerJustCompleted) {
      commitState({ forceTimer: true, forceStatic: true });
    } else {
      syncUi({ forceTimer: true, forceStatic: false });
    }
    await requestWakeLockIfNeeded();
    refreshLoopForPhase();
  });

  window.addEventListener("pageshow", async () => {
    const result = ensureFreshState();
    if (result.dayChanged || result.timerJustCompleted) {
      commitState({ forceTimer: true, forceStatic: true });
    } else {
      syncUi({ forceTimer: true, forceStatic: false });
    }
    await requestWakeLockIfNeeded();
    refreshLoopForPhase();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

ensureDateRollover(state);
lastDayKey = state.currentDate;
applySavedTheme();
bindEvents();
syncUi({ forceTimer: true, forceStatic: true, forceThemes: true });
refreshLoopForPhase();
persist();

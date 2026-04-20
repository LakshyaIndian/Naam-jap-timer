import {
  loadState,
  saveState,
  resetStoredState,
  downloadJson,
  parseImportedState,
  MAX_SLIDESHOW_IMAGES,
  loadSlideshowImages,
  addSlideshowImages,
  deleteSlideshowImageRecord,
  clearSlideshowImages,
  saveSlideshowImages
} from "./storage.js";
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
let slideshowTimeoutId = null;
let slideshowTransitionBusy = false;
let serviceWorkerReloaded = false;
let nextSlidePreloader = null;
let preloadedSlideId = null;

const persist = (message) => {
  const ok = saveState(state);
  if (!ok && message) ui.setSettingsMessage(message);
  return ok;
};

function formatTodayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function applySavedTheme() {
  if (!isValidTheme(state.theme)) state.theme = "deep-maroon-devotional";
  applyTheme(state.theme);
}

async function requestWakeLockIfNeeded() {
  if (!state.settings.wakeLock || state.timer.phase !== "running" || !("wakeLock" in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch { wakeLock = null; }
}

async function releaseWakeLock() {
  try { if (wakeLock) await wakeLock.release(); } catch {} finally { wakeLock = null; }
}

function ensureSlideshowState() {
  if (!state.slideshow || typeof state.slideshow !== "object") state.slideshow = { images: [], running: false, currentIndex: 0, order: [], intervalMs: 5000, lastStartedAt: null };
  state.slideshow.images = Array.isArray(state.slideshow.images) ? state.slideshow.images.slice(0, MAX_SLIDESHOW_IMAGES) : [];
  state.slideshow.order = Array.isArray(state.slideshow.order) ? state.slideshow.order.filter((index) => Number.isInteger(index) && index >= 0 && index < state.slideshow.images.length) : [];
  state.slideshow.intervalMs = Number.isFinite(state.slideshow.intervalMs) ? state.slideshow.intervalMs : 5000;
  state.slideshow.currentIndex = Number.isInteger(state.slideshow.currentIndex) ? state.slideshow.currentIndex : 0;
  const maxIndex = Math.max((state.slideshow.order.length || state.slideshow.images.length) - 1, 0);
  state.slideshow.currentIndex = Math.min(Math.max(state.slideshow.currentIndex, 0), maxIndex);
  state.slideshow.running = Boolean(state.slideshow.running) && state.slideshow.images.length > 0;
}

async function hydrateSlideshowImages() {
  ensureSlideshowState();
  const embeddedImages = state.slideshow.images.filter((image) => typeof image.dataUrl === "string");
  try {
    if (embeddedImages.length) {
      await saveSlideshowImages(embeddedImages.slice(0, MAX_SLIDESHOW_IMAGES));
    }
    const dbImages = await loadSlideshowImages();
    const dbMap = new Map(dbImages.map((image) => [image.id, image]));
    let metadata = state.slideshow.images.map((image) => ({ id: image.id, name: image.name }));
    if (!metadata.length && dbImages.length) {
      metadata = dbImages.map((image) => ({ id: image.id, name: image.name }));
    }
    state.slideshow.images = metadata
      .map((meta) => {
        const full = dbMap.get(meta.id);
        return full ? { id: full.id, name: meta.name || full.name, dataUrl: full.dataUrl } : null;
      })
      .filter(Boolean)
      .slice(0, MAX_SLIDESHOW_IMAGES);
    if (!state.slideshow.images.length && dbImages.length) {
      state.slideshow.images = dbImages.slice(0, MAX_SLIDESHOW_IMAGES).map((image) => ({ id: image.id, name: image.name, dataUrl: image.dataUrl }));
    }
    state.slideshow.order = state.slideshow.order.filter((index) => index >= 0 && index < state.slideshow.images.length);
    if (state.slideshow.order.length !== state.slideshow.images.length) {
      state.slideshow.order = state.slideshow.images.map((_, index) => index);
      state.slideshow.currentIndex = 0;
    }
    persist();
  } catch {
    ui.setSettingsMessage("Slideshow image storage is not available right now.");
    state.slideshow.images = [];
    state.slideshow.order = [];
    state.slideshow.currentIndex = 0;
    state.slideshow.running = false;
  }
}

function ensureFreshState() {
  ensureSlideshowState();
  const previousDayKey = state.currentDate;
  const currentDayKey = ensureDateRollover(state);
  const timerJustCompleted = timer.recoverCompletion(Date.now());
  const dayChanged = previousDayKey !== currentDayKey;
  lastDayKey = currentDayKey;
  return { dayChanged, timerJustCompleted };
}

function getOrderedSlideshowImages() {
  const { images, order } = state.slideshow;
  if (!images.length) return [];
  if (!order.length) return images;
  return order.map((index) => images[index]).filter(Boolean);
}

function getNextOrderedSlide() {
  const orderedImages = getOrderedSlideshowImages();
  if (!orderedImages.length) return null;
  if (orderedImages.length === 1) return orderedImages[0];
  const nextIndex = (state.slideshow.currentIndex + 1) % orderedImages.length;
  return orderedImages[nextIndex] || null;
}

async function preloadUpcomingSlide() {
  const nextImage = getNextOrderedSlide();
  if (!nextImage || !nextImage.dataUrl) {
    nextSlidePreloader = null;
    preloadedSlideId = null;
    return;
  }
  if (preloadedSlideId === nextImage.id) return;
  const img = new Image();
  img.decoding = "async";
  img.src = nextImage.dataUrl;
  try {
    if (typeof img.decode === "function") await img.decode();
  } catch {
    // ignore decode failures and still keep the browser-level preload work
  }
  nextSlidePreloader = img;
  preloadedSlideId = nextImage.id;
}

function shuffleIndexes(length) {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let i = indexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes;
}

function stopSlideshowLoop() {
  if (slideshowTimeoutId !== null) {
    clearTimeout(slideshowTimeoutId);
    slideshowTimeoutId = null;
  }
}

function renderTimerUi(force = false) {
  const phase = state.timer.phase;
  const remainingMs = timer.getRemainingMs(Date.now());
  const displaySecond = Math.ceil(remainingMs / 1000);
  if (!force && phase === timerUiLastPhase && displaySecond === timerUiLastSecond) return;
  ui.renderTimer({ phase, remainingMs, progress: timer.getProgress(Date.now()) });
  timerUiLastPhase = phase;
  timerUiLastSecond = displaySecond;
}

function renderStaticUi(forceThemes = false) {
  const stats = getStats(state.history);
  ui.renderStats({ ...stats, todayLabel: formatTodayLabel(), showStatsOnHome: state.settings.showStatsOnHome });
  ui.renderHistorySummary(stats);
  ui.renderHistoryGroups(getGroupedHistory(state.history));
  ui.renderSettings(state.settings);
  ui.renderSlideshow(state.slideshow, handleDeleteSlideshowImage);
  if (!hasRenderedThemeGrid || forceThemes) {
    ui.renderThemes(state.theme, handleThemeChange);
    hasRenderedThemeGrid = true;
  }
}

function syncUi({ forceTimer = false, forceStatic = false, forceThemes = false } = {}) {
  const { dayChanged, timerJustCompleted } = ensureFreshState();
  renderTimerUi(forceTimer || dayChanged || timerJustCompleted);
  if (forceStatic || dayChanged || lastDayKey !== state.currentDate) renderStaticUi(forceThemes);
  if (state.timer.phase === "completed-awaiting-decision" && !state.timer.completionHandled) handleCompletionEffects();
}

function commitState(options = {}) { persist(); syncUi(options); }

function startTimerLoop() {
  if (animationFrameId !== null) return;
  const tick = () => {
    animationFrameId = null;
    syncUi({ forceTimer: false, forceStatic: false });
    if (state.timer.phase === "running") animationFrameId = requestAnimationFrame(tick);
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
  if (state.timer.phase === "running") startTimerLoop();
  else {
    stopTimerLoop();
    syncUi({ forceTimer: true, forceStatic: false });
  }
}

function transitionToSlide(nextImage) {
  const current = ui.elements.slideshowImageCurrent;
  const upcoming = ui.elements.slideshowImageNext;
  if (!nextImage || slideshowTransitionBusy) return;
  slideshowTransitionBusy = true;
  upcoming.src = nextImage.dataUrl;
  if (preloadedSlideId === nextImage.id && nextSlidePreloader) {
    // browser cache is already warm; assigning src uses the preloaded asset path
  }
  upcoming.classList.add("active");
  window.setTimeout(() => {
    current.src = nextImage.dataUrl;
    current.classList.add("active");
    upcoming.classList.remove("active");
    upcoming.removeAttribute("src");
    slideshowTransitionBusy = false;
    preloadedSlideId = null;
    nextSlidePreloader = null;
    preloadUpcomingSlide();
  }, 380);
}

function scheduleNextSlide() {
  stopSlideshowLoop();
  if (!state.slideshow.running || state.slideshow.images.length <= 1) return;
  preloadUpcomingSlide();
  slideshowTimeoutId = window.setTimeout(() => {
    advanceSlideshow();
    scheduleNextSlide();
  }, state.slideshow.intervalMs);
}

function startSlideshow() {
  ensureSlideshowState();
  if (!state.slideshow.images.length) {
    ui.setSettingsMessage("Add at least one image before starting the slideshow.");
    return;
  }
  state.slideshow.order = shuffleIndexes(state.slideshow.images.length);
  state.slideshow.currentIndex = 0;
  state.slideshow.running = true;
  state.slideshow.lastStartedAt = Date.now();
  commitState({ forceStatic: true });
  preloadUpcomingSlide();
  scheduleNextSlide();
}

function stopSlideshow() {
  state.slideshow.running = false;
  stopSlideshowLoop();
  preloadedSlideId = null;
  nextSlidePreloader = null;
  commitState({ forceStatic: true });
}

function advanceSlideshow() {
  const orderedImages = getOrderedSlideshowImages();
  if (!orderedImages.length) return stopSlideshow();
  if (orderedImages.length === 1) {
    state.slideshow.currentIndex = 0;
    preloadUpcomingSlide();
    return commitState({ forceStatic: true });
  }
  state.slideshow.currentIndex = (state.slideshow.currentIndex + 1) % orderedImages.length;
  transitionToSlide(orderedImages[state.slideshow.currentIndex]);
  persist();
  ui.renderSlideshow(state.slideshow, handleDeleteSlideshowImage);
}

async function handleDeleteSlideshowImage(imageId) {
  ensureSlideshowState();
  if (!state.slideshow.images.length) return;
  const orderedBeforeDelete = getOrderedSlideshowImages();
  const currentImageId = orderedBeforeDelete[state.slideshow.currentIndex]?.id ?? null;
  state.slideshow.images = state.slideshow.images.filter((image) => image.id !== imageId);
  try { await deleteSlideshowImageRecord(imageId); } catch { ui.setSettingsMessage("Could not delete image right now."); }
  if (!state.slideshow.images.length) {
    state.slideshow.order = [];
    state.slideshow.currentIndex = 0;
    state.slideshow.running = false;
    stopSlideshowLoop();
    preloadedSlideId = null;
    nextSlidePreloader = null;
    return commitState({ forceStatic: true });
  }
  state.slideshow.order = shuffleIndexes(state.slideshow.images.length);
  const orderedAfterDelete = getOrderedSlideshowImages();
  const preservedIndex = orderedAfterDelete.findIndex((image) => image.id === currentImageId && image.id !== imageId);
  state.slideshow.currentIndex = preservedIndex >= 0 ? preservedIndex : 0;
  preloadUpcomingSlide();
  if (state.slideshow.running) scheduleNextSlide();
  commitState({ forceStatic: true });
}

async function handleSlideshowFiles(files) {
  const validFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (!validFiles.length) {
    ui.setSettingsMessage("No valid image files were selected.");
    return;
  }
  ensureSlideshowState();
  const remainingSlots = MAX_SLIDESHOW_IMAGES - state.slideshow.images.length;
  if (remainingSlots <= 0) {
    ui.setSettingsMessage(`Slideshow limit reached. You can keep up to ${MAX_SLIDESHOW_IMAGES} images.`);
    return;
  }
  const filesToRead = validFiles.slice(0, remainingSlots);
  if (validFiles.length > remainingSlots) {
    ui.setSettingsMessage(`Only ${remainingSlots} more image${remainingSlots === 1 ? "" : "s"} can be added. Limit is ${MAX_SLIDESHOW_IMAGES}.`);
  }
  const previousSlideshow = JSON.parse(JSON.stringify(state.slideshow));
  const readers = filesToRead.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, name: file.name, dataUrl: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  }));
  try {
    const images = await Promise.all(readers);
    await addSlideshowImages(images);
    state.slideshow.images.push(...images);
    state.slideshow.images = state.slideshow.images.slice(0, MAX_SLIDESHOW_IMAGES);
    state.slideshow.order = state.slideshow.images.map((_, index) => index);
    state.slideshow.currentIndex = 0;
    state.slideshow.running = false;
    stopSlideshowLoop();
    preloadedSlideId = null;
    nextSlidePreloader = null;
    if (!persist()) {
      state.slideshow = previousSlideshow;
      await saveSlideshowImages(previousSlideshow.images || []);
      syncUi({ forceStatic: true });
      throw new Error("Images metadata could not be saved locally. Try again.");
    }
    syncUi({ forceStatic: true });
    if (validFiles.length > remainingSlots) ui.setSettingsMessage(`Added ${images.length} image${images.length === 1 ? "" : "s"}. Limit is ${MAX_SLIDESHOW_IMAGES}.`);
    else ui.setSettingsMessage(`${images.length} image${images.length === 1 ? "" : "s"} added.`);
  } catch (error) {
    state.slideshow = previousSlideshow;
    syncUi({ forceStatic: true });
    ui.setSettingsMessage(error instanceof Error ? error.message : "Image upload failed.");
  }
}

function handleThemeChange(id) {
  if (!isValidTheme(id)) return;
  state.theme = id;
  applyTheme(state.theme);
  ui.setSettingsMessage(`Theme changed to ${ui.getThemeName(id)}.`);
  commitState({ forceTimer: true, forceStatic: true, forceThemes: true });
}

async function playCompletionSound() {
  if (!state.settings.sound) return;
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") await audioContext.resume();
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
  } catch {}
}

function vibrateCompletion() {
  if (state.settings.vibration && "vibrate" in navigator) {
    try { navigator.vibrate([120, 60, 120]); } catch {}
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

async function maybeRestartTimerForSlideshow() {
  if (ui.getActiveScreen() !== "slideshow") return;
  ensureDateRollover(state);
  timer.start();
  await requestWakeLockIfNeeded();
  refreshLoopForPhase();
}

async function handleCountDecision(shouldCount) {
  if (completionInFlight || state.timer.completionDecisionMade) return;
  completionInFlight = true;
  if (shouldCount) {
    state.timer.completionDecisionMade = true;
    ui.elements.countYesButton.disabled = true;
    incrementTodayCount(state);
  }
  timer.setIdle();
  ui.closeCompletionDialog();
  await maybeRestartTimerForSlideshow();
  completionInFlight = false;
  refreshLoopForPhase();
  commitState({ forceTimer: true, forceStatic: true });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (serviceWorkerReloaded) return;
    serviceWorkerReloaded = true;
    window.location.reload();
  });
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");
      registration.update().catch(() => {});
      if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) newWorker.postMessage({ type: "SKIP_WAITING" });
        });
      });
    } catch {}
  });
}

function bindEvents() {
  ui.bindNavigation(() => { if (state.slideshow.running) scheduleNextSlide(); });
  ui.elements.startButton.addEventListener("click", async () => {
    ensureDateRollover(state); timer.start(); await requestWakeLockIfNeeded(); refreshLoopForPhase(); commitState({ forceTimer: true, forceStatic: true });
  });
  ui.elements.pauseButton.addEventListener("click", async () => {
    timer.pause(); await releaseWakeLock(); refreshLoopForPhase(); commitState({ forceTimer: true, forceStatic: false });
  });
  ui.elements.resumeButton.addEventListener("click", async () => {
    timer.resume(); await requestWakeLockIfNeeded(); refreshLoopForPhase(); commitState({ forceTimer: true, forceStatic: false });
  });
  ui.elements.resetButton.addEventListener("click", async () => {
    if (state.settings.confirmReset && !window.confirm("Reset the current 8-minute timer?")) return;
    timer.reset(); await releaseWakeLock(); refreshLoopForPhase(); commitState({ forceTimer: true, forceStatic: false });
  });
  ui.elements.countYesButton.addEventListener("click", (event) => { event.preventDefault(); handleCountDecision(true); });
  ui.elements.countNoButton.addEventListener("click", (event) => { event.preventDefault(); handleCountDecision(false); });
  ui.elements.completionDialog.addEventListener("cancel", (event) => { if (state.timer.phase === "completed-awaiting-decision") event.preventDefault(); });
  ui.elements.slideshowAddButton.addEventListener("click", () => { ui.elements.slideshowFileInput.click(); });
  ui.elements.slideshowFileInput.addEventListener("change", async (event) => {
    const files = event.target.files; event.target.value = ""; if (!files || !files.length) return; await handleSlideshowFiles(files);
  });
  ui.elements.slideshowStartButton.addEventListener("click", () => { startSlideshow(); });
  ui.elements.slideshowStopButton.addEventListener("click", () => { stopSlideshow(); });
  ui.elements.slideshowClearButton.addEventListener("click", async () => {
    if (!state.slideshow.images.length) return;
    if (!window.confirm("Clear all slideshow images?")) return;
    state.slideshow.images = []; state.slideshow.order = []; state.slideshow.currentIndex = 0; state.slideshow.running = false; stopSlideshowLoop();
    preloadedSlideId = null; nextSlidePreloader = null;
    try { await clearSlideshowImages(); } catch { ui.setSettingsMessage("Could not clear slideshow storage completely."); }
    commitState({ forceStatic: true });
  });
  document.getElementById("export-button").addEventListener("click", () => {
    downloadJson(`harivansh-mala-backup-${getLocalDateKey()}.json`, { version: state.version, exportedAt: new Date().toISOString(), history: state.history });
    ui.setSettingsMessage("Backup exported.");
  });
  document.getElementById("import-button").addEventListener("click", () => { document.getElementById("import-file").click(); });
  document.getElementById("import-file").addEventListener("change", async (event) => {
    const [file] = event.target.files || []; event.target.value = ""; if (!file) return;
    try {
      const imported = parseImportedState(await file.text()); mergeHistory(state.history, imported.history); ensureDateRollover(state); ui.setSettingsMessage("Backup imported successfully."); commitState({ forceTimer: true, forceStatic: true });
    } catch (error) { ui.setSettingsMessage(error instanceof Error ? error.message : "Import failed."); }
  });
  document.getElementById("reset-today-button").addEventListener("click", () => {
    if (state.settings.confirmReset && !window.confirm("Reset today's mala count?")) return;
    resetTodayCount(state); ui.setSettingsMessage("Today's count has been reset."); commitState({ forceTimer: false, forceStatic: true });
  });
  document.getElementById("reset-all-button").addEventListener("click", async () => {
    if (!window.confirm("Reset all mala data, history, timer state, and slideshow images? This cannot be undone.")) return;
    resetStoredState(); Object.assign(state, loadState()); ensureSlideshowState(); timer.setIdle(); stopSlideshowLoop();
    preloadedSlideId = null; nextSlidePreloader = null;
    try { await clearSlideshowImages(); } catch {}
    await releaseWakeLock(); applySavedTheme(); hasRenderedThemeGrid = false; ui.setSettingsMessage("All data has been reset."); refreshLoopForPhase(); commitState({ forceTimer: true, forceStatic: true, forceThemes: true });
  });
  document.getElementById("setting-sound").addEventListener("change", (event) => { state.settings.sound = event.target.checked; persist(); });
  document.getElementById("setting-vibration").addEventListener("change", (event) => { state.settings.vibration = event.target.checked; persist(); });
  document.getElementById("setting-confirm-reset").addEventListener("change", (event) => { state.settings.confirmReset = event.target.checked; persist(); });
  document.getElementById("setting-show-stats-home").addEventListener("change", (event) => { state.settings.showStatsOnHome = event.target.checked; commitState({ forceTimer: false, forceStatic: true }); });
  document.getElementById("setting-wake-lock").addEventListener("change", async (event) => {
    state.settings.wakeLock = event.target.checked; if (!state.settings.wakeLock) await releaseWakeLock(); else await requestWakeLockIfNeeded(); persist();
  });
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstallPrompt = event; ui.elements.installButton.hidden = false; });
  ui.elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); try { await deferredInstallPrompt.userChoice; } catch {} deferredInstallPrompt = null; ui.elements.installButton.hidden = true;
  });
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      const result = ensureFreshState();
      if (result.dayChanged || result.timerJustCompleted) commitState({ forceTimer: true, forceStatic: true });
      else syncUi({ forceTimer: true, forceStatic: false });
      await requestWakeLockIfNeeded(); refreshLoopForPhase(); if (state.slideshow.running) scheduleNextSlide();
    } else { persist(); stopTimerLoop(); stopSlideshowLoop(); }
  });
  window.addEventListener("focus", async () => {
    const result = ensureFreshState();
    if (result.dayChanged || result.timerJustCompleted) commitState({ forceTimer: true, forceStatic: true });
    else syncUi({ forceTimer: true, forceStatic: false });
    await requestWakeLockIfNeeded(); refreshLoopForPhase(); if (state.slideshow.running) scheduleNextSlide();
  });
  window.addEventListener("pageshow", async () => {
    const result = ensureFreshState();
    if (result.dayChanged || result.timerJustCompleted) commitState({ forceTimer: true, forceStatic: true });
    else syncUi({ forceTimer: true, forceStatic: false });
    await requestWakeLockIfNeeded(); refreshLoopForPhase(); if (state.slideshow.running) scheduleNextSlide();
  });
}

async function init() {
  ensureDateRollover(state);
  ensureSlideshowState();
  lastDayKey = state.currentDate;
  applySavedTheme();
  bindEvents();
  registerServiceWorker();
  await hydrateSlideshowImages();
  await preloadUpcomingSlide();
  syncUi({ forceTimer: true, forceStatic: true, forceThemes: true });
  refreshLoopForPhase();
  if (state.slideshow.running) scheduleNextSlide();
  persist();
}

init();
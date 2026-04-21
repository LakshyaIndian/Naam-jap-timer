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
let slideshowPersistenceAvailable = true;

const persist = (message) => {
  const ok = saveState(state);
  if (!ok && message) {
    ui.setSettingsMessage(message);
  }
  return ok;
};

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

function ensureSlideshowState() {
  if (!state.slideshow || typeof state.slideshow !== "object") {
    state.slideshow = {
      images: [],
      running: false,
      currentIndex: 0,
      order: [],
      intervalMs: 5000,
      lastStartedAt: null
    };
  }

  state.slideshow.images = Array.isArray(state.slideshow.images) ? state.slideshow.images.slice(0, MAX_SLIDESHOW_IMAGES) : [];
  state.slideshow.intervalMs = Number.isFinite(state.slideshow.intervalMs) ? state.slideshow.intervalMs : 5000;
  state.slideshow.currentIndex = Number.isInteger(state.slideshow.currentIndex) ? state.slideshow.currentIndex : 0;
  state.slideshow.order = Array.isArray(state.slideshow.order) ? state.slideshow.order.filter((index) => Number.isInteger(index)) : [];
}

function getRenderableImages() {
  return state.slideshow.images.filter((image) => image && typeof image.id === "string" && typeof image.name === "string" && typeof image.dataUrl === "string" && image.dataUrl.length > 0);
}

function syncSlideshowState(images, currentImageId = null) {
  const safeImages = images.slice(0, MAX_SLIDESHOW_IMAGES);
  state.slideshow.images = safeImages;
  state.slideshow.order = safeImages.map((_, index) => index);

  if (!safeImages.length) {
    state.slideshow.currentIndex = 0;
    state.slideshow.running = false;
    return;
  }

  if (currentImageId) {
    const index = safeImages.findIndex((image) => image.id === currentImageId);
    state.slideshow.currentIndex = index >= 0 ? index : 0;
  } else {
    state.slideshow.currentIndex = Math.min(state.slideshow.currentIndex, safeImages.length - 1);
  }
}

async function hydrateSlideshowImages() {
  ensureSlideshowState();
  const embeddedImages = getRenderableImages();

  try {
    if (embeddedImages.length) {
      await saveSlideshowImages(embeddedImages);
    }

    const dbImages = await loadSlideshowImages();
    const validDbImages = Array.isArray(dbImages)
      ? dbImages.filter((image) => image && typeof image.id === "string" && typeof image.name === "string" && typeof image.dataUrl === "string")
      : [];

    if (validDbImages.length) {
      syncSlideshowState(validDbImages, state.slideshow.images[state.slideshow.currentIndex]?.id || null);
      slideshowPersistenceAvailable = true;
    } else if (embeddedImages.length) {
      syncSlideshowState(embeddedImages, embeddedImages[state.slideshow.currentIndex]?.id || null);
      slideshowPersistenceAvailable = false;
      ui.setSlideshowMessage("Slideshow images are available for this session. Persistent storage is unavailable right now.");
    } else {
      syncSlideshowState([], null);
      slideshowPersistenceAvailable = true;
    }
  } catch {
    syncSlideshowState(embeddedImages, embeddedImages[state.slideshow.currentIndex]?.id || null);
    slideshowPersistenceAvailable = false;
    if (embeddedImages.length) {
      ui.setSettingsMessage("Slideshow images are available for this session. Persistent storage is unavailable right now.");
    }
  }

  persist();
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
  const images = getRenderableImages();
  if (!images.length) {
    return [];
  }

  const validOrder = state.slideshow.order.filter((index) => index >= 0 && index < images.length);
  return validOrder.length ? validOrder.map((index) => images[index]).filter(Boolean) : images;
}

function getNextOrderedSlide() {
  const orderedImages = getOrderedSlideshowImages();
  if (!orderedImages.length) {
    return null;
  }
  if (orderedImages.length === 1) {
    return orderedImages[0];
  }
  const nextIndex = (state.slideshow.currentIndex + 1) % orderedImages.length;
  return orderedImages[nextIndex] || null;
}

async function preloadUpcomingSlide() {
  const nextImage = getNextOrderedSlide();
  if (!nextImage) {
    nextSlidePreloader = null;
    preloadedSlideId = null;
    return;
  }
  if (preloadedSlideId === nextImage.id) {
    return;
  }
  const img = new Image();
  img.decoding = "async";
  img.src = nextImage.dataUrl;
  try {
    if (typeof img.decode === "function") {
      await img.decode();
    }
  } catch {
    // ignore decode failures
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
  ui.renderSlideshow(state.slideshow, handleDeleteSlideshowImage);

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

function transitionToSlide(nextImage) {
  const current = ui.elements.slideshowImageCurrent;
  const upcoming = ui.elements.slideshowImageNext;

  if (!nextImage || slideshowTransitionBusy) {
    return;
  }

  slideshowTransitionBusy = true;
  upcoming.src = nextImage.dataUrl;
  upcoming.classList.add("active");

  window.setTimeout(() => {
    current.src = nextImage.dataUrl;
    current.classList.add("active");
    upcoming.classList.remove("active");
    upcoming.removeAttribute("src");
    slideshowTransitionBusy = false;
    nextSlidePreloader = null;
    preloadedSlideId = null;
    preloadUpcomingSlide();
  }, 380);
}

function scheduleNextSlide() {
  stopSlideshowLoop();
  if (!state.slideshow.running || getRenderableImages().length <= 1) {
    return;
  }

  preloadUpcomingSlide();
  slideshowTimeoutId = window.setTimeout(() => {
    advanceSlideshow();
    scheduleNextSlide();
  }, state.slideshow.intervalMs);
}

function startSlideshow() {
  const images = getRenderableImages();
  if (!images.length) {
    ui.setSlideshowMessage("Add at least one image before starting the slideshow.");
    return;
  }

  state.slideshow.order = shuffleIndexes(images.length);
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
  nextSlidePreloader = null;
  preloadedSlideId = null;
  commitState({ forceStatic: true });
}

function advanceSlideshow() {
  const orderedImages = getOrderedSlideshowImages();
  if (!orderedImages.length) {
    stopSlideshow();
    return;
  }

  if (orderedImages.length === 1) {
    state.slideshow.currentIndex = 0;
    preloadUpcomingSlide();
    commitState({ forceStatic: true });
    return;
  }

  state.slideshow.currentIndex = (state.slideshow.currentIndex + 1) % orderedImages.length;
  transitionToSlide(orderedImages[state.slideshow.currentIndex]);
  persist();
}

async function handleDeleteSlideshowImage(imageId) {
  const orderedImages = getOrderedSlideshowImages();
  if (!orderedImages.length) {
    return;
  }

  const currentImageId = orderedImages[state.slideshow.currentIndex]?.id ?? null;
  const remainingImages = orderedImages.filter((image) => image.id !== imageId);
  syncSlideshowState(remainingImages, currentImageId === imageId ? remainingImages[0]?.id ?? null : currentImageId);

  if (slideshowPersistenceAvailable) {
    try {
      await deleteSlideshowImageRecord(imageId);
    } catch {
      ui.setSlideshowMessage("Could not delete image from device storage right now.");
    }
  }

  if (!remainingImages.length) {
    stopSlideshowLoop();
    nextSlidePreloader = null;
    preloadedSlideId = null;
  } else if (state.slideshow.running) {
    scheduleNextSlide();
  }

  preloadUpcomingSlide();
  commitState({ forceStatic: true });
}

async function handleSlideshowFiles(files) {
  const validFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (!validFiles.length) {
    ui.setSlideshowMessage("No valid image files were selected.");
    return;
  }

  const existingImages = getRenderableImages();
  const remainingSlots = MAX_SLIDESHOW_IMAGES - existingImages.length;
  if (remainingSlots <= 0) {
    ui.setSlideshowMessage(`Slideshow limit reached. You can keep up to ${MAX_SLIDESHOW_IMAGES} images.`);
    return;
  }

  const filesToRead = validFiles.slice(0, remainingSlots);
  const readers = filesToRead.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: file.name,
      dataUrl: reader.result
    });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  }));

  try {
    const images = await Promise.all(readers);
    const mergedImages = [...existingImages, ...images].slice(0, MAX_SLIDESHOW_IMAGES);
    syncSlideshowState(mergedImages, mergedImages[0]?.id ?? null);
    state.slideshow.running = false;
    stopSlideshowLoop();
    nextSlidePreloader = null;
    preloadedSlideId = null;
    syncUi({ forceStatic: true });
    preloadUpcomingSlide();

    if (slideshowPersistenceAvailable) {
      try {
        await addSlideshowImages(images);
      } catch {
        slideshowPersistenceAvailable = false;
        ui.setSlideshowMessage("Images were added for this session, but device storage is unavailable, so they may not persist after reload.");
      }
    }

    if (!persist()) {
      ui.setSlideshowMessage("Images were added for this session, but metadata could not be saved for future reloads.");
    } else if (validFiles.length > remainingSlots) {
      ui.setSlideshowMessage(`Added ${images.length} image${images.length === 1 ? "" : "s"}. Limit is ${MAX_SLIDESHOW_IMAGES}.`);
    } else if (slideshowPersistenceAvailable) {
      ui.setSlideshowMessage(`${images.length} image${images.length === 1 ? "" : "s"} added.`);
    }
  } catch (error) {
    ui.setSlideshowMessage(error instanceof Error ? error.message : "Image upload failed.");
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
    // ignore autoplay failures
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

async function maybeRestartTimerForSlideshow() {
  if (ui.getActiveScreen() !== "slideshow") {
    return;
  }
  ensureDateRollover(state);
  timer.start();
  await requestWakeLockIfNeeded();
  refreshLoopForPhase();
}

async function handleCountDecision(shouldCount) {
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
  ui.closeCompletionDialog();
  await maybeRestartTimerForSlideshow();
  completionInFlight = false;
  refreshLoopForPhase();
  commitState({ forceTimer: true, forceStatic: true });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (serviceWorkerReloaded) {
      return;
    }
    serviceWorkerReloaded = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");
      registration.update().catch(() => {});
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) {
          return;
        }
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    } catch {
      // no-op
    }
  });
}

function bindEvents() {
  ui.bindNavigation(() => {
    if (state.slideshow.running) {
      scheduleNextSlide();
    }
  });

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

  ui.elements.slideshowAddButton.addEventListener("click", () => {
    ui.elements.slideshowFileInput.click();
  });

  ui.elements.slideshowFileInput.addEventListener("change", async (event) => {
    const files = event.target.files;
    event.target.value = "";
    if (!files || !files.length) {
      return;
    }
    await handleSlideshowFiles(files);
  });

  ui.elements.slideshowStartButton.addEventListener("click", () => {
    startSlideshow();
  });

  ui.elements.slideshowStopButton.addEventListener("click", () => {
    stopSlideshow();
  });

  ui.elements.slideshowClearButton.addEventListener("click", async () => {
    if (!getRenderableImages().length) {
      return;
    }
    if (!window.confirm("Clear all slideshow images?")) {
      return;
    }

    syncSlideshowState([], null);
    stopSlideshowLoop();
    nextSlidePreloader = null;
    preloadedSlideId = null;

    if (slideshowPersistenceAvailable) {
      try {
        await clearSlideshowImages();
      } catch {
        ui.setSlideshowMessage("Could not clear slideshow storage completely.");
      }
    }

    commitState({ forceStatic: true });
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
    if (!window.confirm("Reset all mala data, history, timer state, and slideshow images? This cannot be undone.")) {
      return;
    }

    resetStoredState();
    Object.assign(state, loadState());
    ensureSlideshowState();
    syncSlideshowState([], null);
    timer.setIdle();
    stopSlideshowLoop();
    nextSlidePreloader = null;
    preloadedSlideId = null;

    if (slideshowPersistenceAvailable) {
      try {
        await clearSlideshowImages();
      } catch {
        // ignore
      }
    }

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
      if (state.slideshow.running) {
        scheduleNextSlide();
      }
    } else {
      persist();
      stopTimerLoop();
      stopSlideshowLoop();
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
    if (state.slideshow.running) {
      scheduleNextSlide();
    }
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
    if (state.slideshow.running) {
      scheduleNextSlide();
    }
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
  if (state.slideshow.running) {
    scheduleNextSlide();
  }
  persist();
}

init();
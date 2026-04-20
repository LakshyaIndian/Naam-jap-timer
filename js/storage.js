const STORAGE_KEY = "harivansh-mala-state-v1";

const defaults = () => ({
  version: 1,
  currentDate: "",
  history: {},
  theme: "deep-maroon-devotional",
  settings: {
    sound: true,
    vibration: true,
    confirmReset: true,
    showStatsOnHome: true,
    wakeLock: false
  },
  timer: {
    phase: "idle",
    startedAt: null,
    endAt: null,
    pausedRemainingMs: null,
    completionHandled: false,
    completionDecisionMade: false
  },
  slideshow: {
    images: [],
    running: false,
    currentIndex: 0,
    order: [],
    intervalMs: 5000,
    lastStartedAt: null
  }
});

const isObj = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function sanitizeHistory(history) {
  const safe = {};
  if (!isObj(history)) {
    return safe;
  }

  for (const [key, value] of Object.entries(history)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(value) && value >= 0) {
      safe[key] = Math.floor(value);
    }
  }

  return safe;
}

function sanitizeSlideshow(slideshow) {
  const fallback = defaults().slideshow;

  if (!isObj(slideshow)) {
    return fallback;
  }

  const images = Array.isArray(slideshow.images)
    ? slideshow.images
        .filter((item) => isObj(item) && typeof item.id === "string" && typeof item.name === "string" && typeof item.dataUrl === "string")
        .map((item) => ({ id: item.id, name: item.name, dataUrl: item.dataUrl }))
    : [];

  const order = Array.isArray(slideshow.order)
    ? slideshow.order.filter((index) => Number.isInteger(index) && index >= 0 && index < images.length)
    : [];

  return {
    images,
    running: Boolean(slideshow.running) && images.length > 0,
    currentIndex: Number.isInteger(slideshow.currentIndex) ? Math.max(0, Math.min(slideshow.currentIndex, Math.max(order.length - 1, 0))) : 0,
    order,
    intervalMs: Number.isFinite(slideshow.intervalMs) && slideshow.intervalMs >= 1500 ? Math.floor(slideshow.intervalMs) : fallback.intervalMs,
    lastStartedAt: Number.isFinite(slideshow.lastStartedAt) ? slideshow.lastStartedAt : null
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaults();
    }

    const parsed = JSON.parse(raw);
    const fallback = defaults();

    return {
      version: 1,
      currentDate: typeof parsed.currentDate === "string" ? parsed.currentDate : "",
      history: sanitizeHistory(parsed.history),
      theme: typeof parsed.theme === "string" ? parsed.theme : fallback.theme,
      settings: { ...fallback.settings, ...(isObj(parsed.settings) ? parsed.settings : {}) },
      timer: { ...fallback.timer, ...(isObj(parsed.timer) ? parsed.timer : {}) },
      slideshow: sanitizeSlideshow(parsed.slideshow)
    };
  } catch {
    return defaults();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function resetStoredState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function parseImportedState(text) {
  const parsed = JSON.parse(text);
  const history = sanitizeHistory(parsed.history ?? parsed);
  if (!Object.keys(history).length) {
    throw new Error("Backup file does not contain valid mala history.");
  }
  return { version: 1, history };
}

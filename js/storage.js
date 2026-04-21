const STORAGE_KEY = "harivansh-mala-state-v1";
const DB_NAME = "harivansh-mala-db";
const DB_VERSION = 1;
const IMAGE_STORE = "slideshow-images";
export const MAX_SLIDESHOW_IMAGES = 50;

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
  if (!isObj(history)) return safe;
  for (const [key, value] of Object.entries(history)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(value) && value >= 0) safe[key] = Math.floor(value);
  }
  return safe;
}

function sanitizeSlideshow(slideshow) {
  const fallback = defaults().slideshow;
  if (!isObj(slideshow)) return fallback;

  const images = Array.isArray(slideshow.images)
    ? slideshow.images
        .filter((item) => isObj(item) && typeof item.id === "string" && typeof item.name === "string")
        .slice(0, MAX_SLIDESHOW_IMAGES)
        .map((item) => ({
          id: item.id,
          name: item.name,
          ...(typeof item.dataUrl === "string" ? { dataUrl: item.dataUrl } : {})
        }))
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

function stripStateForStorage(state) {
  const slideshow = isObj(state.slideshow) ? state.slideshow : defaults().slideshow;
  return {
    ...state,
    slideshow: {
      ...slideshow,
      images: Array.isArray(slideshow.images)
        ? slideshow.images.slice(0, MAX_SLIDESHOW_IMAGES).map((image) => ({ id: image.id, name: image.name }))
        : []
    }
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripStateForStorage(state)));
    return true;
  } catch {
    return false;
  }
}

export function resetStoredState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
  });
}

function runStore(mode, operation) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE, mode);
    const store = transaction.objectStore(IMAGE_STORE);
    let request;
    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      db.close();
      return;
    }
    transaction.oncomplete = () => {
      db.close();
      resolve(request?.result);
    };
    transaction.onerror = () => {
      reject(transaction.error || new Error("IndexedDB transaction failed."));
      db.close();
    };
    transaction.onabort = () => {
      reject(transaction.error || new Error("IndexedDB transaction aborted."));
      db.close();
    };
  }));
}

export function loadSlideshowImages() {
  return runStore("readonly", (store) => store.getAll()).then((records) => Array.isArray(records) ? records : []);
}

export function saveSlideshowImages(images) {
  return runStore("readwrite", (store) => {
    store.clear();
    (images || []).slice(0, MAX_SLIDESHOW_IMAGES).forEach((image) => {
      store.put({ id: image.id, name: image.name, dataUrl: image.dataUrl });
    });
    return null;
  });
}

export function addSlideshowImages(images) {
  return runStore("readwrite", (store) => {
    (images || []).forEach((image) => {
      store.put({ id: image.id, name: image.name, dataUrl: image.dataUrl });
    });
    return null;
  });
}

export function deleteSlideshowImageRecord(id) {
  return runStore("readwrite", (store) => store.delete(id));
}

export function clearSlideshowImages() {
  return runStore("readwrite", (store) => store.clear());
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
  if (!Object.keys(history).length) throw new Error("Backup file does not contain valid mala history.");
  return { version: 1, history };
}

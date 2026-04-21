import { THEMES, getThemeMeta } from "./themes.js";

const RING_CIRCUMFERENCE = 2 * Math.PI * 68;
const qs = (id) => document.getElementById(id);

export function createUi() {
  const elements = {
    installButton: qs("install-button"),
    timerDisplay: qs("timer-display"),
    timerStatus: qs("timer-status"),
    timerSubtext: qs("timer-subtext"),
    progressRing: qs("progress-ring"),
    todayCount: qs("today-count"),
    todayLabel: qs("today-label"),
    monthTotal: qs("month-total"),
    yearTotal: qs("year-total"),
    allTimeTotal: qs("all-time-total"),
    homeAllTimeCard: qs("home-all-time-card"),
    historySummary: qs("history-summary"),
    historyGroups: qs("history-groups"),
    historyEmpty: qs("history-empty"),
    themeGrid: qs("theme-grid"),
    settingsMessage: qs("settings-message"),
    completionDialog: qs("completion-dialog"),
    countYesButton: qs("count-yes-button"),
    countNoButton: qs("count-no-button"),
    startButton: qs("start-button"),
    pauseButton: qs("pause-button"),
    resumeButton: qs("resume-button"),
    resetButton: qs("reset-button"),
    slideshowAddButton: qs("slideshow-add-button"),
    slideshowFileInput: qs("slideshow-file-input"),
    slideshowStartButton: qs("slideshow-start-button"),
    slideshowStopButton: qs("slideshow-stop-button"),
    slideshowClearButton: qs("slideshow-clear-button"),
    slideshowImageCurrent: qs("slideshow-image-current"),
    slideshowImageNext: qs("slideshow-image-next"),
    slideshowEmpty: qs("slideshow-empty"),
    slideshowCounter: qs("slideshow-counter"),
    slideshowStatus: qs("slideshow-status"),
    slideshowThumbs: qs("slideshow-thumbs"),
    slideshowMessage: qs("slideshow-message")
  };

  elements.progressRing.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
  elements.progressRing.style.strokeDashoffset = `${RING_CIRCUMFERENCE}`;

  const formatMs = (ms) => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  function renderTimer({ phase, remainingMs, progress }) {
    elements.timerDisplay.textContent = formatMs(remainingMs);
    elements.progressRing.style.strokeDashoffset = `${RING_CIRCUMFERENCE * (1 - progress)}`;
    elements.pauseButton.classList.remove("hidden");
    elements.resumeButton.classList.add("hidden");

    if (phase === "running") {
      elements.timerStatus.textContent = "Running";
      elements.timerSubtext.textContent = "Stay steady in the chant.";
      elements.startButton.disabled = true;
      elements.pauseButton.disabled = false;
    } else if (phase === "paused") {
      elements.timerStatus.textContent = "Paused";
      elements.timerSubtext.textContent = "Resume when you are ready.";
      elements.startButton.disabled = true;
      elements.pauseButton.disabled = true;
      elements.resumeButton.classList.remove("hidden");
    } else if (phase === "completed-awaiting-decision") {
      elements.timerStatus.textContent = "Completed";
      elements.timerSubtext.textContent = "Confirm whether to count 1 mala.";
      elements.startButton.disabled = true;
      elements.pauseButton.disabled = true;
    } else {
      elements.timerStatus.textContent = "Ready";
      elements.timerSubtext.textContent = "Tap start when you begin.";
      elements.startButton.disabled = false;
      elements.pauseButton.disabled = true;
    }
  }

  function renderStats({ today, month, year, allTime, todayLabel, showStatsOnHome }) {
    elements.todayCount.textContent = String(today);
    elements.todayLabel.textContent = todayLabel;
    elements.monthTotal.textContent = String(month);
    elements.yearTotal.textContent = String(year);
    elements.allTimeTotal.textContent = String(allTime);
    elements.homeAllTimeCard.classList.toggle("hidden", !showStatsOnHome);
  }

  function renderHistorySummary(stats) {
    elements.historySummary.innerHTML = "";
    [["Today", stats.today], ["This Month", stats.month], ["All Time", stats.allTime]].forEach(([label, value]) => {
      const chip = document.createElement("div");
      chip.className = "summary-chip";
      chip.innerHTML = `<div class="summary-chip-label">${label}</div><div class="summary-chip-value">${value}</div>`;
      elements.historySummary.appendChild(chip);
    });
  }

  function renderHistoryGroups(groups) {
    elements.historyGroups.innerHTML = "";
    elements.historyEmpty.hidden = groups.length > 0;

    groups.forEach((group) => {
      const section = document.createElement("section");
      section.className = "history-month";
      section.innerHTML = `<div class="history-month-header"><div class="history-month-title">${group.title}</div><div class="history-month-total">${group.total} mala</div></div><div class="history-items"></div>`;
      const items = section.querySelector(".history-items");

      group.items.forEach((item) => {
        const article = document.createElement("article");
        article.className = "history-item";
        article.innerHTML = `<div><div class="history-date">${item.dateLabel}</div><div class="history-subdate">${item.subLabel}</div></div><div class="history-count">${item.count}</div>`;
        items.appendChild(article);
      });

      elements.historyGroups.appendChild(section);
    });
  }

  function renderThemes(currentTheme, onSelect) {
    elements.themeGrid.innerHTML = "";

    THEMES.forEach((theme) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `theme-button${theme.id === currentTheme ? " selected" : ""}`;

      const swatch = document.createElement("div");
      swatch.className = "theme-swatch";
      theme.colors.forEach((color) => {
        const dot = document.createElement("span");
        dot.className = "theme-dot";
        dot.style.background = color;
        swatch.appendChild(dot);
      });

      button.appendChild(swatch);

      const name = document.createElement("div");
      name.className = "theme-name";
      name.textContent = theme.name;
      button.appendChild(name);

      const meta = document.createElement("div");
      meta.className = "theme-meta";
      meta.textContent = theme.id.replaceAll("-", " ");
      button.appendChild(meta);

      button.addEventListener("click", () => onSelect(theme.id));
      elements.themeGrid.appendChild(button);
    });
  }

  function renderSettings(settings) {
    qs("setting-sound").checked = settings.sound;
    qs("setting-vibration").checked = settings.vibration;
    qs("setting-confirm-reset").checked = settings.confirmReset;
    qs("setting-show-stats-home").checked = settings.showStatsOnHome;
    qs("setting-wake-lock").checked = settings.wakeLock;
  }

  const getImageSrc = (image) => (image && (image.src || image.dataUrl)) || "";

  function renderSlideshow(slideshow, onDelete) {
    const allImages = Array.isArray(slideshow.images) ? slideshow.images : [];
    const order = Array.isArray(slideshow.order) ? slideshow.order : [];
    const renderableImages = allImages.filter((image) => image && getImageSrc(image));
    const orderedImages = order.length > 0
      ? order.filter((i) => Number.isInteger(i) && i >= 0 && i < allImages.length).map((i) => allImages[i]).filter((image) => image && getImageSrc(image))
      : renderableImages;
    const safeIndex = Math.min(Math.max(Number.isInteger(slideshow.currentIndex) ? slideshow.currentIndex : 0, 0), Math.max(orderedImages.length - 1, 0));
    const currentImage = orderedImages[safeIndex] || orderedImages[0] || null;
    const hasRenderableImages = orderedImages.length > 0;

    elements.slideshowCounter.textContent = `${renderableImages.length} image${renderableImages.length === 1 ? "" : "s"}`;
    elements.slideshowStatus.textContent = slideshow.running && hasRenderableImages ? "Running in random order" : "Stopped";
    elements.slideshowEmpty.hidden = hasRenderableImages;
    elements.slideshowStartButton.disabled = !hasRenderableImages;
    elements.slideshowStopButton.disabled = !slideshow.running;
    elements.slideshowClearButton.disabled = renderableImages.length === 0;

    if (currentImage) {
      const currentSrc = getImageSrc(currentImage);
      if (elements.slideshowImageCurrent.src !== currentSrc) {
        elements.slideshowImageCurrent.src = currentSrc;
      }
      elements.slideshowImageCurrent.classList.add("active");
    } else {
      elements.slideshowImageCurrent.removeAttribute("src");
      elements.slideshowImageCurrent.classList.remove("active");
      elements.slideshowImageNext.removeAttribute("src");
      elements.slideshowImageNext.classList.remove("active");
    }

    elements.slideshowThumbs.innerHTML = "";
    orderedImages.forEach((image, index) => {
      const thumb = document.createElement("article");
      thumb.className = `slideshow-thumb${index === safeIndex ? " active" : ""}`;
      const imgSrc = getImageSrc(image);
      thumb.innerHTML = `<img src="${imgSrc}" alt="${image.name}" class="slideshow-thumb-image" /><div class="slideshow-thumb-footer"><div class="slideshow-thumb-name"></div></div>`;
      thumb.querySelector(".slideshow-thumb-name").textContent = image.name;

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "slideshow-thumb-delete";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => onDelete(image.id));
      thumb.querySelector(".slideshow-thumb-footer").appendChild(deleteButton);
      elements.slideshowThumbs.appendChild(thumb);
    });
  }

  const setSettingsMessage = (message) => {
    elements.settingsMessage.textContent = message;
  };

  const setSlideshowMessage = (message) => {
    elements.slideshowMessage.textContent = message;
  };

  function showCompletionDialog(disableYes = false) {
    elements.countYesButton.disabled = disableYes;
    if (typeof elements.completionDialog.showModal === "function" && !elements.completionDialog.open) {
      elements.completionDialog.showModal();
    }
  }

  function closeCompletionDialog() {
    if (elements.completionDialog.open) {
      elements.completionDialog.close();
    }
  }

  function bindNavigation(onChange) {
    const buttons = [...document.querySelectorAll(".tab-button")];
    const screens = [...document.querySelectorAll(".screen")];

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.screen;
        buttons.forEach((item) => item.classList.toggle("active", item === button));
        screens.forEach((screen) => screen.classList.toggle("active", screen.id === `screen-${target}`));
        if (onChange) {
          onChange(target);
        }
      });
    });
  }

  function getActiveScreen() {
    const active = document.querySelector(".tab-button.active");
    return active ? active.dataset.screen : "home";
  }

  return {
    elements,
    renderTimer,
    renderStats,
    renderHistorySummary,
    renderHistoryGroups,
    renderThemes,
    renderSettings,
    renderSlideshow,
    setSettingsMessage,
    setSlideshowMessage,
    showCompletionDialog,
    closeCompletionDialog,
    bindNavigation,
    getActiveScreen,
    getThemeName: (id) => getThemeMeta(id).name
  };
}

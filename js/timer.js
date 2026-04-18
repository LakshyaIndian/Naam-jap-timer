const TIMER_DURATION = 8 * 60 * 1000;

let timerState = {
  startTime: null,
  elapsedBeforePause: 0,
  running: false
};

function startTimer() {
  if (timerState.running) return;

  timerState.startTime = Date.now();
  timerState.running = true;
  persistTimer();
}

function pauseTimer() {
  if (!timerState.running) return;

  timerState.elapsedBeforePause += Date.now() - timerState.startTime;
  timerState.running = false;
  persistTimer();
}

function resetTimer() {
  timerState = { startTime: null, elapsedBeforePause: 0, running: false };
  persistTimer();
  updateDisplay(TIMER_DURATION);
  updateRing(0);
}

function getElapsed() {
  if (!timerState.startTime) return timerState.elapsedBeforePause;

  if (timerState.running) {
    return timerState.elapsedBeforePause + (Date.now() - timerState.startTime);
  }

  return timerState.elapsedBeforePause;
}

function getRemaining() {
  return Math.max(TIMER_DURATION - getElapsed(), 0);
}

function tick() {
  if (!timerState.running) return;

  let remaining = getRemaining();
  let progress = getElapsed() / TIMER_DURATION;

  updateDisplay(remaining);
  updateRing(progress);

  if (remaining <= 0) {
    timerState.running = false;
    persistTimer();
    onTimerComplete();
  }
}

setInterval(tick, 1000);

function persistTimer() {
  localStorage.setItem("timer_state", JSON.stringify(timerState));
}

function restoreTimer() {
  try {
    timerState = JSON.parse(localStorage.getItem("timer_state")) || timerState;
  } catch {}
}

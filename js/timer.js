const TIMER_DURATION = 8 * 60 * 1000;

let timerState = {
  startTime: null,
  elapsedBeforePause: 0,
  running: false,
  startDate: null
};

function startTimer() {
  if (timerState.running) return;

  if (!timerState.startDate) {
    timerState.startDate = new Date().toISOString().split("T")[0];
  }

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
  timerState = { startTime: null, elapsedBeforePause: 0, running: false, startDate: null };
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

    // midnight-safe completion
    const today = new Date().toISOString().split("T")[0];
    const sameDay = timerState.startDate === today;

    onTimerComplete(sameDay);
  }
}

setInterval(tick, 1000);

function persistTimer() {
  try{
    localStorage.setItem("timer_state", JSON.stringify(timerState));
  }catch{}
}

function restoreTimer() {
  try {
    const parsed = JSON.parse(localStorage.getItem("timer_state"));
    if(parsed && typeof parsed === 'object'){
      timerState = parsed;
    }
  } catch {
    timerState = { startTime:null, elapsedBeforePause:0, running:false, startDate:null };
  }
}

document.addEventListener("DOMContentLoaded",()=>{
  restoreTimer();
  initUI();

  document.getElementById("startBtn").onclick=startTimer;
  document.getElementById("pauseBtn").onclick=pauseTimer;
  document.getElementById("resetBtn").onclick=resetTimer;

  document.getElementById("yesBtn").onclick=confirmMala;
  document.getElementById("noBtn").onclick=closeModal;

  updateTodayCount();

  const remaining = getRemaining();
  updateDisplay(remaining);
  updateRing(getElapsed()/(8*60*1000));

  loadTheme();
  renderThemes();

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js");
  }
});
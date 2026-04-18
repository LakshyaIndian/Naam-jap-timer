document.addEventListener("DOMContentLoaded",()=>{
  restoreTimer();
  initUI();

  document.getElementById("startBtn").onclick=startTimer;
  document.getElementById("pauseBtn").onclick=pauseTimer;
  document.getElementById("resetBtn").onclick=resetTimer;

  document.getElementById("yesBtn").onclick=confirmMala;
  document.getElementById("noBtn").onclick=closeModal;

  updateTodayCount();

  // restore UI state
  const remaining = getRemaining();
  updateDisplay(remaining);
  updateRing(getElapsed()/(8*60*1000));

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js");
  }

  // wake lock
  if('wakeLock' in navigator){
    let wakeLock = null;
    const requestWakeLock = async () => {
      try{
        wakeLock = await navigator.wakeLock.request('screen');
      }catch(e){}
    };
    requestWakeLock();
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible') requestWakeLock();
    });
  }
});
let confirmLock=false;

function confirmMala(){
  if(confirmLock) return;
  confirmLock=true;

  let data=getData();
  let today=getTodayKey();

  if(!data[today]) data[today]=0;
  data[today]++;

  saveData(data);
  updateTodayCount();
  closeModal();
  resetTimer();

  setTimeout(()=>confirmLock=false,500);
}

function updateTodayCount(){
  let data=getData();
  let today=getTodayKey();
  document.getElementById("todayCount").innerText=(data[today]||0)+" malas today";
}

/* date rollover */
document.addEventListener("visibilitychange",()=>{
  updateTodayCount();
});
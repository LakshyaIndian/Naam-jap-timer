function updateDisplay(ms){
  let sec=Math.floor(ms/1000);
  let m=String(Math.floor(sec/60)).padStart(2,"0");
  let s=String(sec%60).padStart(2,"0");
  document.getElementById("timerDisplay").innerText=`${m}:${s}`;
}

function updateRing(progress){
  const ring=document.querySelector(".ring");
  if(!ring) return;
  const deg=Math.min(progress,1)*360;
  ring.style.background=`conic-gradient(var(--accent) ${deg}deg, rgba(255,255,255,0.05) ${deg}deg)`;
}

function showModal(){document.getElementById("modal").classList.remove("hidden")}
function closeModal(){document.getElementById("modal").classList.add("hidden")}

function playSound(){
  try{
    const audio=new Audio();
    audio.src="data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEA";
    audio.play().catch(()=>{});
  }catch{}
}

function onTimerComplete(sameDay=true){
  try{navigator.vibrate?.(200)}catch{}
  playSound();
  updateRing(1);

  if(!sameDay){
    alert("Timer crossed midnight. Mala will count for new day.");
  }

  showModal();
}

function initUI(){
  document.querySelectorAll("nav button").forEach(btn=>{
    btn.onclick=()=>{
      document.querySelectorAll("section").forEach(s=>s.classList.remove("active"));
      document.getElementById(btn.dataset.tab).classList.add("active");
    }
  })
}

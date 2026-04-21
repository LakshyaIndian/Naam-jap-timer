export const TIMER_DURATION_MS = 8 * 60 * 1000;
export function createTimerApi(state){
  function setIdle(){ state.timer.phase="idle"; state.timer.startedAt=null; state.timer.endAt=null; state.timer.pausedRemainingMs=null; state.timer.completionHandled=false; state.timer.completionDecisionMade=false; }
  function start(){ const now=Date.now(); state.timer.phase="running"; state.timer.startedAt=now; state.timer.endAt=now + TIMER_DURATION_MS; state.timer.pausedRemainingMs=null; state.timer.completionHandled=false; state.timer.completionDecisionMade=false; }
  function pause(){ if (state.timer.phase!=="running" || !Number.isFinite(state.timer.endAt)) return; state.timer.pausedRemainingMs=Math.max(0,state.timer.endAt-Date.now()); state.timer.phase="paused"; state.timer.endAt=null; }
  function resume(){ if (state.timer.phase!=="paused" || !Number.isFinite(state.timer.pausedRemainingMs)) return; const now=Date.now(); state.timer.phase="running"; state.timer.startedAt=now; state.timer.endAt=now + state.timer.pausedRemainingMs; state.timer.pausedRemainingMs=null; }
  function reset(){ setIdle(); }
  function getRemainingMs(now=Date.now()){ if (state.timer.phase==="running" && Number.isFinite(state.timer.endAt)) return Math.max(0,state.timer.endAt-now); if (state.timer.phase==="paused" && Number.isFinite(state.timer.pausedRemainingMs)) return Math.max(0,state.timer.pausedRemainingMs); return TIMER_DURATION_MS; }
  function getProgress(now=Date.now()){ const remaining=getRemainingMs(now); return Math.min(1,Math.max(0,(TIMER_DURATION_MS-remaining)/TIMER_DURATION_MS)); }
  function recoverCompletion(now=Date.now()){ if (state.timer.phase==="running" && Number.isFinite(state.timer.endAt) && now>=state.timer.endAt){ state.timer.phase="completed-awaiting-decision"; state.timer.completionHandled=false; state.timer.completionDecisionMade=false; state.timer.pausedRemainingMs=0; return true; } return false; }
  return { start,pause,resume,reset,getRemainingMs,getProgress,recoverCompletion,setIdle };
}

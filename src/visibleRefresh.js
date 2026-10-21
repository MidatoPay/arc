// Recursive scheduling avoids overlapping requests. Hidden tabs do no polling.
export function startVisibleRefresh(refresh,{intervalMs=120000,minFocusMs=15000,document=globalThis.document,window=globalThis.window,
  now=Date.now,schedule=setTimeout,cancel=clearTimeout}={}) {
  let stopped=false,running=false,timer,lastStarted=-Infinity;
  const visible=()=>!document || document.visibilityState==='visible';
  const run=async()=>{
    if(stopped || running || !visible())return;
    running=true;lastStarted=now();cancel(timer);
    try {await refresh();}catch{ /* Preserve the last successful view. */ }
    finally {
      running=false;
      if(!stopped && visible())timer=schedule(run,intervalMs);
    }
  };
  const wake=()=>{
    cancel(timer);
    if(!visible() || stopped || running)return;
    const delay=minFocusMs-(now()-lastStarted);
    if(delay>0)timer=schedule(run,delay);else void run();
  };
  document?.addEventListener('visibilitychange',wake);
  window?.addEventListener('focus',wake);
  void run();
  return ()=>{stopped=true;cancel(timer);document?.removeEventListener('visibilitychange',wake);window?.removeEventListener('focus',wake);};
}

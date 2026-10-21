// Only read models belong here. Never cache authorization or money-moving checks.
// Netlify's Cache API shares entries across function instances in a region.
export function createReadCache({ now=Date.now, storage=()=>globalThis.caches, maxEntries=256 }={}) {
  const memory=new Map(),pending=new Map();
  return async function read(key,ttlMs,load,{fresh=false}={}) {
    const existing=memory.get(key);
    if(!fresh && existing?.until>now())return existing.value;
    const active=pending.get(key);
    if(active && (!fresh || active.fresh))return active.task;
    const marker={};
    const task=(async()=>{
      let cache;
      const url=`https://midatopay.internal/read-cache/${encodeURIComponent(key)}`;
      try {cache=await storage()?.open('wallet-read-models-v1');} catch { /* Local runtime may not provide Cache API. */ }
      if(!fresh && cache) {
        try {
          const response=await cache.match(url);
          if(response) {
            const saved=await response.json();
            if(saved.until>now()) {
              if(pending.get(key)?.marker===marker)remember(key,saved);
              return saved.value;
            }
          }
        } catch { /* A cache failure must not masquerade as a zero balance. */ }
      }
      const value=await load(),saved={value,until:now()+ttlMs};
      if(pending.get(key)?.marker===marker)remember(key,saved);
      if(cache && pending.get(key)?.marker===marker) {
        try {await cache.put(url,new Response(JSON.stringify(saved),{headers:{'Cache-Control':`public, max-age=${Math.ceil(ttlMs/1000)}`,'Content-Type':'application/json'}}));}
        catch { /* Keep the bounded per-instance cache when shared storage is unavailable. */ }
      }
      return value;
    })();
    pending.set(key,{task,fresh,marker});
    try {return await task;} finally {if(pending.get(key)?.marker===marker)pending.delete(key);}
  };
  function remember(key,saved) {
    memory.delete(key);memory.set(key,saved);
    if(memory.size>maxEntries)memory.delete(memory.keys().next().value);
  }
}

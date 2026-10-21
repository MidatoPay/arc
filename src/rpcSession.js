let session=null;
export function setRpcSession(userId,getAccessToken) {
  const current=userId ? {userId,getAccessToken} : null;
  session=current;
  return ()=>{if(session===current)session=null;};
}
export async function rpcAccessToken() {
  const current=session;
  if(!current)throw new Error('rpc_session_required');
  const token=await current.getAccessToken();
  if(!token || current!==session)throw new Error('rpc_session_required');
  return token;
}

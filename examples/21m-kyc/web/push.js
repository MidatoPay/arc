const $ = id => document.getElementById(id);
const config = await fetch('/config').then(r => r.json());
let registration;
let refreshing = false;
const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
const supportedButtons = ['push-enable','push-disable','push-test'];
const say = text => { $('push-message').textContent = text; };
const customer = () => $('push-customer').value.trim();
async function request(action, body = {}) {
  const response = await fetch('/api', {method:'POST', headers:{'content-type':'application/json','x-local-token':config.token},body:JSON.stringify({action,customerId:customer(),body})});
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Error HTTP ${response.status}`);
  return data;
}
function keyBytes(value) {
  const raw = atob(value.replaceAll('-','+').replaceAll('_','/') + '='.repeat((4-value.length%4)%4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function subscription() { return registration ? registration.pushManager.getSubscription() : null; }
async function refresh() {
  if (!customer() || refreshing) return;
  refreshing = true;
  try {
    const sub = await subscription();
    const data = await request('push-status', {endpoint:sub?.endpoint});
    $('push-state').textContent = data.active ? `Avisos activos para ${customer()}` : 'Este navegador no tiene avisos activos para este cliente.';
    $('push-monitor').textContent = data.lastError || (data.lastPollAt ? `Última consulta: ${new Date(data.lastPollAt).toLocaleString()}. Pendientes de envío: ${data.pending}.` : 'El monitor consulta cada 30 segundos cuando hay avisos activos.');
    const list = $('push-deposits'); list.replaceChildren();
    for (const d of data.deposits) {
      const li = document.createElement('li');li.textContent = `${d.amount} ${d.currency} · ${new Date(d.created_at).toLocaleString()} · ${d.id}`;list.append(li);
    }
    if (!data.deposits.length) { const li = document.createElement('li'); li.textContent = 'Todavía no se detectaron transferencias nuevas para este cliente.';list.append(li); }
  } catch (error) { say(error.message); } finally { refreshing = false; }
}
async function withBusy(fn) {
  supportedButtons.forEach(id => $(id).disabled = true);
  try { await fn(); } catch (error) { say(error.message); }
  finally { supportedButtons.forEach(id => $(id).disabled = !supported || !config.pushPublicKey); }
}
$('push-enable').onclick = () => withBusy(async () => {
  if (!customer()) throw new Error('Completá el ID de cliente para activar sus avisos.');
  // Called directly from the user's click so the browser can request permission.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No se concedió permiso. Permití las notificaciones para 127.0.0.1 desde la configuración del navegador.');
  registration = await navigator.serviceWorker.ready;
  let sub = await subscription();
  const newlyCreated = !sub;
  if (!sub) sub = await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.pushPublicKey)});
  try { await request('push-subscribe', {subscription:sub.toJSON()}); }
  catch (error) { if (newlyCreated) await sub.unsubscribe(); throw error; }
  localStorage.setItem('21m-push-customer', customer());
  say('Avisos activados. Podés cerrar la pestaña; mantené el servidor local encendido.');
  await refresh();
});
$('push-disable').onclick = () => withBusy(async () => {
  const sub = await subscription();
  if (sub) { await request('push-unsubscribe', {endpoint:sub.endpoint}); await sub.unsubscribe(); }
  localStorage.removeItem('21m-push-customer');say('Avisos desactivados para este navegador.');await refresh();
});
$('push-test').onclick = () => withBusy(async () => {
  const sub = await subscription();
  if (!sub) throw new Error('Primero activá los avisos.');
  await request('push-test', {endpoint:sub.endpoint});say('Prueba aceptada por el servicio push. La notificación llegará por el mismo canal que las transferencias.');
});
$('push-refresh').onclick = refresh;
$('push-use-customer').onclick = () => { $('push-customer').value = $('customerId').value.trim(); void refresh(); };
$('push-customer').onchange = refresh;
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message',event => {
  if(event.data?.type === 'push-open') { $('push-customer').value=event.data.customerId;location.hash='notificaciones';void refresh(); }
});
$('push-customer').value = new URLSearchParams(location.search).get('customer') || localStorage.getItem('21m-push-customer') || '';
if (!supported) {
  supportedButtons.forEach(id => $(id).disabled = true);
  say('Este navegador no permite Web Push aquí. Abrí http://127.0.0.1:3210 en Chrome, Edge o un navegador con Web Push habilitado.');
} else if (!config.pushPublicKey) {
  supportedButtons.forEach(id => $(id).disabled = true);say('Reiniciá el servidor para habilitar las notificaciones push.');
} else {
  try { registration = await navigator.serviceWorker.register('/sw.js');say('Listo para activar los avisos. En Brave puede ser necesario habilitar los servicios de Google para mensajes push.'); }
  catch { supportedButtons.forEach(id => $(id).disabled = true);say('No se pudo registrar el servicio de notificaciones del navegador.'); }
}
await refresh();
setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);

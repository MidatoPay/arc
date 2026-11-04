import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import webpush from 'web-push';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export function validateSubscription(value) {
  let url;
  try { url = new URL(value?.endpoint); } catch { fail('Suscripción push inválida.'); }
  const host = url.hostname;
  const allowed = host === 'fcm.googleapis.com' || host === 'web.push.apple.com' ||
    host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com') ||
    host.endsWith('.notify.windows.com');
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || value.endpoint.length > 4096) {
    fail('El navegador no entregó un destino push compatible.');
  }
  for (const [name, size] of [['p256dh', 65], ['auth', 16]]) {
    const key = value.keys?.[name];
    if (typeof key !== 'string' || !/^[\w-]+={0,2}$/.test(key) || Buffer.from(key, 'base64url').length !== size) {
      fail('Las claves de la suscripción push no son válidas.');
    }
  }
  return { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

async function atomicJson(path, value) {
  const temp = path + '.tmp';
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}

export async function createPushService({ directory, key, upstream = fetch, now = () => Date.now(), transport } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const statePath = join(directory, 'notifications.json');
  const vapidPath = join(directory, 'vapid.json');
  let vapid;
  try { vapid = JSON.parse(await readFile(vapidPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; vapid = webpush.generateVAPIDKeys(); await atomicJson(vapidPath, vapid); }
  let state = { checkpoint: null, subscriptions: {}, deposits: {}, outbox: {} };
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const deliver = transport || ((subscription, payload) => webpush.sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: { subject: 'https://127.0.0.1:3210', ...vapid }, TTL: 86400, urgency: 'high', timeout: 15000,
  }));
  let chain = Promise.resolve();
  let timer;
  let lastError = null;
  let lastPollAt = null;
  const locked = fn => { const result = chain.then(fn); chain = result.catch(() => {}); return result; };
  const save = () => atomicJson(statePath, state);
  const validCustomer = id => { if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) fail('Completá un ID de cliente válido.'); };
  function summary(customerId, endpoint) {
    const records = Object.values(state.deposits).filter(d => d.customer_id === customerId).sort((a,b) => b.created_at.localeCompare(a.created_at));
    const sub = endpoint ? state.subscriptions[hash(endpoint)] : null;
    return { active: !!sub && sub.customerId === customerId, customerId,
      pollSeconds: 30, lastPollAt, lastError, deposits: records.slice(0, 30),
      pending: Object.values(state.outbox).filter(x => x.customerId === customerId && !x.sentAt).length };
  }
  async function flush() {
    for (const [id, item] of Object.entries(state.outbox)) {
      if (item.sentAt || item.nextAttempt > now()) continue;
      const sub = state.subscriptions[item.subscriptionId];
      if (!sub || sub.customerId !== item.customerId) { delete state.outbox[id]; continue; }
      try {
        await deliver(sub.subscription, item.payload);
        item.sentAt = new Date(now()).toISOString(); item.error = null;
      } catch (error) {
        if ([404,410].includes(error.statusCode)) {
          delete state.subscriptions[item.subscriptionId];
          for (const [task, value] of Object.entries(state.outbox)) if (value.subscriptionId === item.subscriptionId) delete state.outbox[task];
        } else {
          item.attempts = (item.attempts || 0) + 1;
          const retryHeader = Number(error.headers?.['retry-after']);
          item.nextAttempt = now() + Math.max(Math.min(3600000, 30000 * 2 ** Math.min(item.attempts, 7)), Number.isFinite(retryHeader) ? retryHeader * 1000 : 0);
          item.error = 'Servicio push no disponible; se reintentará.';
        }
      }
      await save();
    }
  }
  async function poll() {
    if (!Object.keys(state.subscriptions).length) return;
    const cutoff = new Date(now()).toISOString();
    const from = new Date((state.checkpoint ? Date.parse(state.checkpoint) : now()) - 600000).toISOString();
    const received = [];
    try {
      if (!key?.startsWith('nx_test_')) throw new Error('Falta una credencial de staging.');
      let offset = 0, total;
      do {
        const query = new URLSearchParams({ from, to: cutoff, limit: '100', offset: String(offset) });
        const response = await upstream(`https://api.staging.21millions.com/v1/partner/deposits?${query}`, {
          headers: { 'x-api-key': key }, signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`21Millions respondió HTTP ${response.status}.`);
        const data = await response.json();
        if (!Array.isArray(data.deposits) || !Number.isInteger(data.total) || data.total < 0 || (!data.deposits.length && offset < data.total)) throw new Error('Respuesta de depósitos incompleta.');
        total = data.total; received.push(...data.deposits); offset += data.deposits.length;
      } while (offset < total);
      const next = structuredClone(state);
      for (const deposit of received) {
        if (!deposit.id || !deposit.customer_id || !Number.isFinite(Date.parse(deposit.created_at)) || !['ARS','USDT','USDC'].includes(deposit.currency) || typeof deposit.amount !== 'string' || !/^\d+(\.\d+)?$/.test(deposit.amount)) throw new Error('Un depósito tiene datos inválidos.');
        const destinations = Object.entries(next.subscriptions).filter(([,sub]) => sub.customerId === deposit.customer_id && Date.parse(deposit.created_at) >= sub.activatedAt);
        if (!destinations.length || next.deposits[deposit.id]) continue;
        next.deposits[deposit.id] = { id: deposit.id, customer_id: deposit.customer_id, amount: deposit.amount, currency: deposit.currency, created_at: deposit.created_at, type: deposit.type };
        for (const [subscriptionId] of destinations) {
          const task = hash(`${deposit.id}:${subscriptionId}`);
          next.outbox[task] = { subscriptionId, customerId: deposit.customer_id, nextAttempt: 0,
            payload: { title: 'Nueva transferencia recibida', body: `Recibiste ${deposit.amount} ${deposit.currency}.`, tag: `21m-${hash(deposit.id)}`, customerId: deposit.customer_id, kind: 'deposit' } };
        }
      }
      next.checkpoint = cutoff;
      await atomicJson(statePath, next); state = next; lastPollAt = cutoff; lastError = null;
    } catch (error) {
      lastError = error.cause?.code === 'EACCES' ? 'El servidor no tiene permiso de red.' : error.name === 'TimeoutError' ? '21Millions no respondió a tiempo; se reintentará.' : error.message;
    }
    await flush();
  }
  return {
    publicKey: vapid.publicKey,
    subscribe: (customerId, value) => locked(async () => {
      validCustomer(customerId); const subscription = validateSubscription(value); const id = hash(subscription.endpoint);
      const old = state.subscriptions[id];
      if (old?.customerId !== customerId) for (const [task, item] of Object.entries(state.outbox)) if (item.subscriptionId === id) delete state.outbox[task];
      state.subscriptions[id] = { customerId, subscription, activatedAt: old?.customerId === customerId ? old.activatedAt : now() };
      await save(); return summary(customerId, subscription.endpoint);
    }),
    unsubscribe: (endpoint) => locked(async () => {
      const id = hash(endpoint); delete state.subscriptions[id];
      for (const [task,item] of Object.entries(state.outbox)) if (item.subscriptionId === id) delete state.outbox[task];
      await save(); return { active: false };
    }),
    status: (customerId, endpoint) => locked(async () => {validCustomer(customerId); return summary(customerId, endpoint);}),
    test: (customerId, endpoint) => locked(async () => {
      validCustomer(customerId); const id = hash(endpoint); const sub = state.subscriptions[id];
      if (!sub || sub.customerId !== customerId) fail('Activá los avisos para este cliente primero.');
      try { await deliver(sub.subscription, { title: 'Push de prueba · 21Millions', body: 'Los avisos de nuevas transferencias están activados. Esta es una prueba, no un ingreso de dinero.', tag: `test-${randomUUID()}`, customerId, kind: 'test' }); }
      catch { throw Object.assign(new Error('El servicio push no pudo entregar la prueba. Revisá los permisos del navegador y la conexión del servidor.'), {status:502}); }
      return { sent: true };
    }),
    poll: () => locked(poll),
    start() { if (!timer) { timer = setInterval(() => { void locked(poll).catch(() => { lastError = 'No se pudo guardar el estado local; revisar el servidor.'; }); }, 30000); timer.unref(); } },
    async stop() { clearInterval(timer); timer = null; await chain; },
  };
}

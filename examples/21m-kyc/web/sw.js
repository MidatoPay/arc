self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let message;
  try { message = event.data?.json(); } catch { /* A malformed push still gets a visible notification. */ }
  message ||= {};
  event.waitUntil(self.registration.showNotification(message.title || '21Millions · Aviso', {
    body: message.body || 'Tenés una nueva actualización en la prueba.',
    tag: message.tag || '21m-update', renotify: false,
    data: { customerId: message.customerId || '', kind: message.kind || 'update' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL('/', self.location.origin);
  url.searchParams.set('customer', event.notification.data?.customerId || '');
  url.hash = 'notificaciones';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      existing.postMessage({ type: 'push-open', customerId: event.notification.data?.customerId || '' });
      await existing.focus();
    } else await self.clients.openWindow(url.href);
  })());
});

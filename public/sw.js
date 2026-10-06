// AskLocker's service worker. It does two things only: show a reminder
// that arrives by Web Push (migration 034, the `push` Edge Function), and
// open the app when one is tapped. It caches nothing and never sees the
// app's own requests, so it cannot serve a stale app after a deploy.
//
// A message is JSON: { title, body, url, tag } (PushMessage in
// supabase/functions/_shared/webpush.ts).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'AskLocker', {
      body: message.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      // A newer reminder for the same document replaces the older one, and still alerts.
      tag: message.tag || undefined,
      renotify: Boolean(message.tag),
      data: { url: message.url || '/notifications' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/notifications', self.location.origin);
  // Only ever within the app.
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/notifications';
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = open.find((client) => new URL(client.url).origin === self.location.origin);
    if (app) {
      await app.focus();
      if ('navigate' in app) await app.navigate(url).catch(() => undefined);
      return;
    }
    await self.clients.openWindow(url);
  })());
});

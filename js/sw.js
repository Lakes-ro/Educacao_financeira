/**
 * sw.js — Caixinhas (100% local, sem servidor)
 * - App shell: network-first com fallback para cache (funciona offline)
 * - Fontes do Google: cache-first
 * - Aumente CACHE_VERSION a cada deploy para forçar atualização
 */

const CACHE_VERSION = 'v14-local';
const CACHE_NAME    = `caixinhas-${CACHE_VERSION}`;

const CACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(CACHE_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('caixinhas-') && k !== CACHE_NAME && k !== 'caixinhas-meta')
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Recursos externos (fontes): cache-first
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      }).catch(() => new Response('', { status: 503 })))
    );
    return;
  }

  // App local: network-first → cache
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((cached) =>
        cached || caches.match('./index.html') || new Response('Offline', { status: 503 })
      ))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Lembrete com o app fechado (Periodic Background Sync) ──
// Funciona no Chrome/Android com o app instalado. O próprio sistema decide
// quando rodar (geralmente algumas vezes por dia). O app grava um resumo mínimo
// em cache local (caixinhas-meta) — nada sai do aparelho.

const META_CACHE = 'caixinhas-meta';
const META_URL   = './__caixinhas-meta.json';

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function lerMeta() {
  try {
    const cache = await caches.open(META_CACHE);
    const res = await cache.match(META_URL);
    return res ? await res.json() : null;
  } catch { return null; }
}

async function salvarMeta(meta) {
  const cache = await caches.open(META_CACHE);
  await cache.put(META_URL, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
}

async function lembreteEmSegundoPlano() {
  const meta = await lerMeta();
  if (!meta || !meta.pushEnabled) return;

  const hora = new Date().getHours();
  if (hora < 8 || hora >= 22) return;                   // não incomoda fora de hora

  const hoje = hojeLocal();
  if (meta.ultimoRegistro === hoje) return;             // já registrou hoje
  if (meta.ultimoAvisoSW === hoje) return;              // no máximo 1 aviso por dia

  // Se o app está aberto e visível, o próprio app cuida do lembrete
  const abertos = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (abertos.some((c) => c.visibilityState === 'visible')) return;

  const frases = hora < 12
    ? ['Bom dia! ☀️ Já tem gastos pra anotar hoje?', 'Cafezinho, transporte, mercado — anota tudo hoje! 💛']
    : hora < 18
      ? ['Boa tarde! Você já registrou os gastos de hoje?', 'Não deixa para depois! Registra agora enquanto lembra 🌤']
      : ['Antes de dormir: o que você gastou hoje? Leva 30 segundos! 🌙', 'É hora de fechar o dia financeiro — o que saiu? 📝'];

  await self.registration.showNotification(meta.appName || 'Caixinhas', {
    body:  frases[Math.floor(Math.random() * frases.length)],
    icon:  'icon-192.png',
    badge: 'icon-192.png',
    tag:   'lembrete-diario',
    renotify: true,
    data:  { url: './' },
  });

  meta.ultimoAvisoSW = hoje;
  await salvarMeta(meta);
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'caixinhas-lembrete') event.waitUntil(lembreteEmSegundoPlano());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.focus);
      if (existing) return existing.focus();
      return clients.openWindow('./');
    })
  );
});
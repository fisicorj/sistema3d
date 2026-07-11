const CACHE='sistema3d-v7';
const CORE=['/','/index.html','/manifest.webmanifest','/css/styles.css','/css/phase2.css','/css/phase3-radar.css','/css/bootstrap-app.css','/js/sql-wasm.js','/js/sql-wasm.wasm','/js/constants.js','/js/db.js','/js/utils.js','/js/bootstrap-ui.js','/js/sprint5.js','/js/sprint6.js',
  '/js/sprint7.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url); if(e.request.method!=='GET'||u.pathname.startsWith('/api/')) return; e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/index.html'))));});

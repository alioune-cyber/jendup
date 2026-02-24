const CACHE_NAME = 'jendup-v1';
const DYNAMIC_CACHE = 'jendup-dynamic-v1';

// Fichiers à mettre en cache lors de l'installation
const STATIC_ASSETS = [
  '/',
  'home.html',
  'annonces.html',
  'detail-annonce.html',
  'vendre.html',
  'mes-produits.html',
  'historique_commande.html',
  'historique-ventes.html',
  'connexion.html',
  'inscription.html',
  'contact.html',
  'cgv.html',
  'confidentialite.html',
  'offline.html',
  'manifest.json',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js',
  'https://unpkg.com/@supabase/supabase-js@2',
  'script.js',
  'logo.png',                    // ✅ Une seule icône
];

// Installation du service worker
self.addEventListener('install', (event) => {
  console.log('📦 Service Worker: Installation...');
  
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Mise en cache des ressources statiques');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch(error => {
        console.error('❌ Erreur lors du cache:', error);
      })
  );
});

// Activation du service worker
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker: Activation...');
  
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('🗑️ Suppression ancien cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('✅ Service Worker activé');
      return self.clients.claim();
    })
  );
});

// Stratégie de cache
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  if (event.request.url.includes('supabase.co')) {
    return;
  }
  
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(event.request, clone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then(cached => {
            return cached || caches.match('offline.html');
          });
        })
    );
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        
        return fetch(event.request)
          .then(response => {
            if (response.ok && event.request.url.startsWith(self.location.origin)) {
              const clone = response.clone();
              caches.open(DYNAMIC_CACHE).then(cache => {
                cache.put(event.request, clone);
              });
            }
            return response;
          })
          .catch(() => {
            if (event.request.url.match(/\.(jpg|jpeg|png|gif|svg|webp)$/)) {
              return caches.match('logo.png');
            }
          });
      })
  );
});

// Gestion des notifications push (simplifiée)
self.addEventListener('push', (event) => {
  try {
    const data = event.data.json();
    
    const options = {
      body: data.body || 'Nouvelle notification',
      icon: 'logo.png',                    // ✅ Une seule icône
      badge: 'logo.png',                    // ✅ La même pour le badge
      vibrate: [200, 100, 200],
      data: {
        url: data.url || '/'
      },
      actions: [
        { action: 'open', title: 'Voir' },
        { action: 'close', title: 'Fermer' }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'jëndUp', options)
    );
  } catch (error) {
    console.error('Erreur notification push:', error);
  }
});

// Gestion des clics sur les notifications
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window' })
        .then(clientList => {
          const url = event.notification.data.url;
          
          for (const client of clientList) {
            if (client.url === url && 'focus' in client) {
              return client.focus();
            }
          }
          if (clients.openWindow) {
            return clients.openWindow(url);
          }
        })
    );
  }
});

// Background sync simplifié (optionnel)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-commandes') {
    console.log('🔄 Synchronisation en arrière-plan');
  }
});
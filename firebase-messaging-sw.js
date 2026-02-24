/*// firebase-messaging-sw.js - À placer à la racine de votre site
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js');

firebase.initializeApp({
    apiKey: "AIzaSyBLcvIpMw-ZVN8XHFCxMD7fQ0IOs1qqmyI",
    authDomain: "jendup-6162a.firebaseapp.com",
    projectId: "jendup-6162a",
    storageBucket: "jendup-6162a.firebasestorage.app",
    messagingSenderId: "21521884456",
    appId: "1:21521884456:web:7c29b39156ef5e00b79c1d",
    measurementId: "G-GGHFPB23QX"
});

const messaging = firebase.messaging();

// Gérer les notifications en background
messaging.onBackgroundMessage((payload) => {
    console.log('Notification en background:', payload);
    
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        data: payload.data,
        actions: [
            { action: 'open', title: 'Voir la commande' },
            { action: 'close', title: 'Fermer' }
        ]
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Gérer le clic sur la notification
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    if (event.action === 'open') {
        const urlToOpen = event.notification.data?.url || '/';
        event.waitUntil(clients.openWindow(urlToOpen));
    }
});*/
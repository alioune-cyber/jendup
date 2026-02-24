// firebase-config.js - À ajouter dans votre projet
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js';

const firebaseConfig = {
    apiKey: "AIzaSyBLcvIpMw-ZVN8XHFCxMD7fQ0IOs1qqmyI",
    authDomain: "jendup-6162a.firebaseapp.com",
    projectId: "jendup-6162a",
    storageBucket: "jendup-6162a.firebasestorage.app",
    messagingSenderId: "21521884456",
    appId: "1:21521884456:web:7c29b39156ef5e00b79c1d",
    measurementId: "G-GGHFPB23QX"
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

// Demander la permission et enregistrer le token
export async function requestNotificationPermission(userId) {
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const token = await getToken(messaging, {
                vapidKey: 'o1FiR5YsKWJb5Urk9FUUJ9AEO4krTzRvT4C5fWazgTQ'
            });
            
            // Sauvegarder le token dans Supabase
            await saveFcmToken(userId, token);
            
            console.log('✅ Token FCM enregistré:', token);
            return token;
        }
    } catch (error) {
        console.error('❌ Erreur permission notifications:', error);
    }
}

// Sauvegarder le token dans Supabase
async function saveFcmToken(userId, token) {
    const { error } = await supabase1
        .from('fcm_tokens')
        .upsert({ 
            user_id: userId, 
            token: token,
            updated_at: new Date().toISOString()
        });
    
    if (error) console.error('Erreur sauvegarde token:', error);
}

// Écouter les messages quand l'app est ouverte
onMessage(messaging, (payload) => {
    console.log('Message reçu:', payload);
    // Afficher une notification personnalisée
    new Notification(payload.notification.title, {
        body: payload.notification.body,
        icon: '/icon-192.png'
    });
});
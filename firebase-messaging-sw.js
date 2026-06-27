importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCjFyxrJsrcJx5QmHaL0p_eQaSB83PpaS4",
  authDomain: "emboobate-cd9c1.firebaseapp.com",
  projectId: "emboobate-cd9c1",
  storageBucket: "emboobate-cd9c1.firebasestorage.app",
  messagingSenderId: "572353552640",
  appId: "1:572353552640:web:4704ef080c381b6ec7d3e5"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'Emboobate', {
    body: n.body || '',
    icon: 'logo.png',
    badge: 'logo.png'
  });
});

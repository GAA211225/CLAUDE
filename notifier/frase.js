// Frase del día: envía una notificación push con la frase de motivación.
// Corre en GitHub Actions todos los días a las 6:00 am hora de México.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const messaging = admin.messaging();

const frases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'frases.json'), 'utf8'));

// Fecha en hora de Ciudad de México para que la frase coincida con la de la app.
const mx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); // YYYY-MM-DD
const [y, m, d] = mx.split('-').map(Number);
const idx = Math.round(Date.UTC(y, m - 1, d) / 86400000) % frases.length;
const frase = frases[idx];

(async () => {
  const tokensSnap = await db.collection('dietaTokens').get();
  const tokens = tokensSnap.docs.map((t) => t.data().token).filter(Boolean);
  if (!tokens.length) {
    console.log('No hay dispositivos registrados para la frase diaria.');
    return;
  }

  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: '💪 Frase del día', body: frase },
    data: {
      icon: 'https://gaa211225.github.io/CLAUDE/dieta-icon-192.png',
      url: 'https://gaa211225.github.io/CLAUDE/dieta.html'
    },
    webpush: {
      notification: { icon: 'https://gaa211225.github.io/CLAUDE/dieta-icon-192.png' },
      fcmOptions: { link: 'https://gaa211225.github.io/CLAUDE/dieta.html' }
    }
  });

  console.log(`Frase enviada: "${frase}" — ok: ${res.successCount}, fallidas: ${res.failureCount}`);

  // Limpia tokens inválidos (dispositivos que ya no existen).
  const toDelete = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = (r.error && r.error.code) || '';
      if (
        code.includes('registration-token-not-registered') ||
        code.includes('invalid-argument') ||
        code.includes('invalid-registration-token')
      ) {
        toDelete.push(tokens[i]);
      }
    }
  });
  for (const t of toDelete) {
    await db.collection('dietaTokens').doc(t).delete().catch(() => {});
  }
  if (toDelete.length) console.log(`Tokens inválidos eliminados: ${toDelete.length}`);
})().catch((e) => {
  console.error('Error en la frase diaria:', e);
  process.exit(1);
});

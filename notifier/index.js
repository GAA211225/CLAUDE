// Robot diario: revisa pedidos próximos a vencer y envía notificaciones push.
// Corre en GitHub Actions una vez al día.
const admin = require('firebase-admin');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const messaging = admin.messaging();

// Avisar cuando falte 1 día o menos (hoy, mañana o vencido).
const THRESHOLD_DAYS = 1;

function daysLeft(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - t0) / 86400000);
}

(async () => {
  const ordersSnap = await db.collection('orders').get();
  const due = [];
  ordersSnap.forEach((doc) => {
    const o = doc.data();
    if (o.estatus === 'entregado') return;
    const dl = daysLeft(o.cambio);
    if (dl !== null && dl <= THRESHOLD_DAYS) {
      due.push({ cliente: o.cliente || 'Cliente', dl });
    }
  });

  if (!due.length) {
    console.log('Sin pedidos por vencer. No se envía nada.');
    return;
  }

  const count = due.length;
  const names = [...new Set(due.map((d) => d.cliente))];
  const namesText = names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : '');
  const title = `Cambio de aguas: ${count} pedido${count > 1 ? 's' : ''} por vencer`;
  const body = `Revisa: ${namesText}`;

  const tokensSnap = await db.collection('fcmTokens').get();
  const tokens = tokensSnap.docs.map((d) => d.data().token).filter(Boolean);
  if (!tokens.length) {
    console.log('No hay dispositivos registrados para notificar.');
    return;
  }

  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      notification: { icon: 'https://gaa211225.github.io/CLAUDE/logo.png' },
      fcmOptions: { link: 'https://gaa211225.github.io/CLAUDE/embobate.html' }
    }
  });

  console.log(`Enviadas: ${res.successCount}, fallidas: ${res.failureCount}`);

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
    await db.collection('fcmTokens').doc(t).delete().catch(() => {});
  }
  if (toDelete.length) console.log(`Tokens inválidos eliminados: ${toDelete.length}`);
})().catch((e) => {
  console.error('Error en el notificador:', e);
  process.exit(1);
});

// Envía los tickets de venta encolados (colección "ticketsQueue") por WhatsApp.
// Cada pedido nuevo con teléfono se encola desde la app con status:'pending'.
// Este script corre seguido (cada ~15 min) en GitHub Actions; si aún no hay
// credenciales de WhatsApp configuradas, termina sin error (modo "preparado,
// aún no activado").

const admin = require('firebase-admin');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const GRAPH_VERSION = 'v21.0';

// Nombre e idioma EXACTOS de la plantilla de ticket aprobada en Meta.
const TEMPLATE_NAME = 'ticket_venta';
const TEMPLATE_LANG = 'es_MX';

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) return '52' + d;
  if (d.length === 12 && d.startsWith('52')) return d;
  if (d.length === 13 && d.startsWith('521')) return d;
  if (d.length === 11 && d.startsWith('1')) return '52' + d.slice(1);
  return d;
}

function money(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-MX');
}

async function sendTicketTemplate(to, t) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`;
  const resumen = `${t.items} - Total: ${money(t.total)}` +
    (t.pago === 'abonado' ? ` (Abonado: ${money(t.abono)}, Resta: ${money(t.resta)})` : '');
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANG },
      components: [
        { type: 'body', parameters: [
          { type: 'text', text: t.cliente },
          { type: 'text', text: resumen },
        ] },
      ],
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && json.error.message) || JSON.stringify(json);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return json;
}

(async () => {
  if (!TOKEN || !PHONE_ID) {
    console.log('WHATSAPP_TOKEN/WHATSAPP_PHONE_ID no configurados todavía. Nada que hacer (preparado, no activado).');
    return;
  }

  const snap = await db.collection('ticketsQueue').where('status', '==', 'pending').get();
  if (snap.empty) {
    console.log('Sin tickets pendientes.');
    return;
  }

  let sent = 0, failed = 0;

  for (const doc of snap.docs) {
    const t = doc.data();
    const to = normalizePhone(t.telefono);
    if (!to) {
      await doc.ref.update({ status: 'failed', error: 'Teléfono inválido' });
      failed++;
      continue;
    }
    try {
      await sendTicketTemplate(to, t);
      await doc.ref.update({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp() });
      console.log(`Ticket enviado a ${t.cliente} (${to})`);
      sent++;
    } catch (e) {
      await doc.ref.update({ status: 'failed', error: e.message });
      console.error(`Falló ticket de ${t.cliente} (${to}): ${e.message}`);
      failed++;
    }
  }

  console.log(`Resumen -> enviados: ${sent}, fallidos: ${failed}`);
})().catch((e) => {
  console.error('Error en el envío de tickets:', e);
  process.exit(1);
});

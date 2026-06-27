// Bot de WhatsApp: invita a los clientes a agendar su pedido.
// Recorre la colección "clients" de Firestore y, a cada cliente que no haya
// sido contactado en los últimos 3 días, le manda una plantilla aprobada de
// WhatsApp (Cloud API) rotando el producto estrella recomendado.
// Corre en GitHub Actions una vez al día; el filtro de 3 días da la cadencia.

const admin = require('firebase-admin');

// --- Credenciales de Firebase (mismo secreto que el notificador push) ---
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// --- Credenciales de WhatsApp Cloud API ---
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const GRAPH_VERSION = 'v21.0';

// Nombre e idioma EXACTOS de la plantilla aprobada en Meta.
const TEMPLATE_NAME = 'recordatorio_pedido';
const TEMPLATE_LANG = 'es_MX';

// Cada cuántos días, como mínimo, se vuelve a escribir a un mismo cliente.
const THRESHOLD_DAYS = 3;

// Productos estrella que rotan en la variable {{1}} de la plantilla.
// El texto debe encajar en "Nuestra recomendación de hoy: ___".
const PRODUCTS = [
  'un cremoso Latte de Taro',
  'un reconfortante Latte de Chai',
  'una refrescante agua de Horchata',
  'una deliciosa agua de Tamarindo',
  'una refrescante agua de Jamaica',
];

// Modo prueba: si WHATSAPP_TEST_TO trae números (separados por coma),
// solo se envía a esos (los que están en la lista de prueba de Meta).
const TEST_TO = (process.env.WHATSAPP_TEST_TO || '')
  .split(',')
  .map((s) => s.replace(/\D/g, ''))
  .filter(Boolean);

// Modo simulación: no envía nada, solo imprime a quién enviaría.
const DRY_RUN = process.env.DRY_RUN === '1';

function daysSince(ts) {
  if (!ts) return Infinity;
  const then = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(then)) return Infinity;
  return (Date.now() - then.getTime()) / 86400000;
}

// Normaliza un teléfono mexicano a formato internacional (52 + 10 dígitos).
function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) return '52' + d;          // 4921234567 -> 524921234567
  if (d.length === 12 && d.startsWith('52')) return d;
  if (d.length === 13 && d.startsWith('521')) return d; // ya trae el 1 móvil
  if (d.length === 11 && d.startsWith('1')) return '52' + d.slice(1);
  return d; // último recurso: mandar lo que haya
}

async function sendTemplate(to, producto) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANG },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: producto }] },
      ],
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
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
    throw new Error('Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID.');
  }

  const snap = await db.collection('clients').get();

  // Índice de rotación global (persistido para que el producto avance entre corridas).
  const cfgRef = db.collection('config').doc('whatsappBroadcast');
  const cfgSnap = await cfgRef.get();
  let rot = (cfgSnap.exists && cfgSnap.data().rotationIndex) || 0;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const c = doc.data();
    const to = normalizePhone(c.phone);
    if (!to) { skipped++; continue; }

    // En modo prueba, solo números de la lista permitida por Meta.
    if (TEST_TO.length && !TEST_TO.includes(to)) { skipped++; continue; }

    // Respeta la cadencia: no reescribir si se contactó hace < 3 días.
    if (daysSince(c.lastWhatsappContact) < THRESHOLD_DAYS) { skipped++; continue; }

    const producto = PRODUCTS[rot % PRODUCTS.length];

    if (DRY_RUN) {
      console.log(`[DRY] ${c.name || 'Cliente'} (${to}) -> ${producto}`);
      rot++;
      sent++;
      continue;
    }

    try {
      await sendTemplate(to, producto);
      await doc.ref.update({
        lastWhatsappContact: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`Enviado a ${c.name || 'Cliente'} (${to}) -> ${producto}`);
      rot++;
      sent++;
    } catch (e) {
      failed++;
      console.error(`Falló ${c.name || 'Cliente'} (${to}): ${e.message}`);
    }
  }

  if (!DRY_RUN) {
    await cfgRef.set({ rotationIndex: rot }, { merge: true });
  }

  console.log(`Resumen -> enviados: ${sent}, omitidos: ${skipped}, fallidos: ${failed}`);
})().catch((e) => {
  console.error('Error en el bot de WhatsApp:', e);
  process.exit(1);
});

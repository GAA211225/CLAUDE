// Webhook de WhatsApp: recibe respuestas de clientes, interpreta el pedido
// por palabras clave, lo deja "por aprobar", avisa al dueño y -al aprobar-
// lo registra en la colección "orders" que lee embobate.html.
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// --- Configuración (se inyecta como variables de entorno al desplegar) ---
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const OWNER_PHONE = (process.env.OWNER_PHONE || '').replace(/\D/g, '');
const GRAPH_VERSION = 'v21.0';

// Sabores válidos en la app (deben coincidir con window.FLAVORS de embobate.html).
// Cada sabor canónico con sus variantes escritas (sin acentos, en minúsculas).
const FLAVOR_SYNONYMS = {
  'Piña': ['pina', 'pinia', 'pin'],
  'Jamaica': ['jamaica'],
  'Horchata': ['horchata', 'orchata'],
  'Taro': ['taro'],
  'Chai': ['chai', 'chay'],
};

// Números escritos con palabra (1-12) para clientes que no usan dígitos.
const WORD_NUM = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

function strip(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Interpreta el texto del cliente -> { 'Jamaica': 5, 'Horchata': 3 }
function parseOrder(text) {
  const t = ' ' + strip(text).replace(/[^\w\sñ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const out = {};
  for (const [canon, variants] of Object.entries(FLAVOR_SYNONYMS)) {
    for (const v of variants) {
      // Patrón "5 jamaica" / "5 de jamaica" / "5 aguas de jamaica" / "dos taro"
      const numWords = Object.keys(WORD_NUM).join('|');
      const re = new RegExp(
        `(\\d+|${numWords})\\s+(?:de\\s+)?(?:aguas?\\s+de\\s+|latte?s?\\s+de\\s+|vasos?\\s+de\\s+|botellas?\\s+de\\s+)?${v}\\b` +
        `|${v}\\s*[:x]?\\s*(\\d+)`,
        'g'
      );
      let m;
      let qty = 0;
      while ((m = re.exec(t)) !== null) {
        const raw = m[1] || m[2];
        const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : WORD_NUM[raw] || 0;
        if (n > 0) qty += n;
      }
      if (qty > 0) out[canon] = (out[canon] || 0) + qty;
    }
  }
  return out;
}

function fmtItems(sabores) {
  return Object.entries(sabores).map(([f, q]) => `${f} x${q}`).join(', ');
}

function today() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

async function sendText(to, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    console.error('Error enviando WhatsApp:', res.status, JSON.stringify(j));
  }
}

// Busca el nombre del cliente en la colección "clients" por teléfono.
async function findClientName(phone) {
  const tail = phone.slice(-10); // últimos 10 dígitos
  const snap = await db.collection('clients').get();
  for (const doc of snap.docs) {
    const p = String(doc.data().phone || '').replace(/\D/g, '');
    if (p && p.slice(-10) === tail) return doc.data().name;
  }
  return null;
}

async function handleCustomer(from, name, text) {
  const sabores = parseOrder(text);
  const clientName = (await findClientName(from)) || name || 'Cliente';

  if (!Object.keys(sabores).length) {
    await sendText(
      from,
      '¡Gracias por escribir! 🌟 Para agendar tu pedido dime la cantidad y el sabor, ' +
      'por ejemplo: "5 Jamaica, 3 Horchata". Sabores: Piña, Jamaica, Horchata, Taro y Chai. 🥤'
    );
    return;
  }

  const code = String(Math.floor(1000 + Math.random() * 9000));
  await db.collection('pendingOrders').add({
    cliente: clientName.toUpperCase(),
    telefono: from,
    sabores,
    raw: text,
    code,
    status: 'por_aprobar',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Avisar al dueño para que apruebe.
  if (OWNER_PHONE) {
    await sendText(
      OWNER_PHONE,
      `🆕 *Pedido nuevo*\n` +
      `Cliente: ${clientName} (${from})\n` +
      `Pedido: ${fmtItems(sabores)}\n\n` +
      `Responde *SI ${code}* para registrar o *NO ${code}* para descartar.`
    );
  }

  // Confirmar recepción al cliente.
  await sendText(
    from,
    `¡Perfecto! 🚀 Anotamos: ${fmtItems(sabores)}. ` +
    `En un momento te confirmamos tu pedido. ✨`
  );
}

async function handleOwner(text) {
  const m = strip(text).match(/^\s*(si|no)\s*(\d{4})\s*$/);
  if (!m) return; // el dueño escribió otra cosa; ignorar
  const decision = m[1];
  const code = m[2];

  const snap = await db
    .collection('pendingOrders')
    .where('code', '==', code)
    .where('status', '==', 'por_aprobar')
    .limit(1)
    .get();

  if (snap.empty) {
    await sendText(OWNER_PHONE, `No encontré un pedido pendiente con código ${code}.`);
    return;
  }

  const doc = snap.docs[0];
  const p = doc.data();

  if (decision === 'no') {
    await doc.ref.update({ status: 'rechazado' });
    await sendText(OWNER_PHONE, `❌ Pedido ${code} descartado.`);
    return;
  }

  // Aprobado: registrar en "orders" con el MISMO esquema que el formulario.
  await db.collection('orders').add({
    cliente: p.cliente,
    telefono: p.telefono,
    fecha: today(),
    sabores: p.sabores,
    estatus: 'pendiente',
    pago: 'pendiente',
    abono: 0,
    elab: '',
    cambio: '',
  });
  await doc.ref.update({ status: 'aprobado' });

  await sendText(OWNER_PHONE, `✅ Registrado: ${p.cliente} — ${fmtItems(p.sabores)}.`);
  await sendText(
    p.telefono,
    `¡Tu pedido quedó agendado! 🚀 ${fmtItems(p.sabores)}. Gracias por tu preferencia. ✨`
  );
}

exports.whatsapp = onRequest(async (req, res) => {
  // 1) Verificación del webhook (Meta manda un GET una sola vez).
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // 2) Mensajes entrantes.
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (msg && msg.type === 'text') {
      const from = String(msg.from).replace(/\D/g, '');
      const name = entry?.contacts?.[0]?.profile?.name;
      const text = msg.text.body;
      if (OWNER_PHONE && from.slice(-10) === OWNER_PHONE.slice(-10)) {
        await handleOwner(text);
      } else {
        await handleCustomer(from, name, text);
      }
    }
  } catch (e) {
    console.error('Error procesando webhook:', e);
  }
  // Siempre 200 para que Meta no reintente en bucle.
  return res.sendStatus(200);
});

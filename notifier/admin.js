// Herramienta de administración: lee/escribe datos de Firestore desde CI.
// ACTION=read  -> imprime precios y clientes existentes.
// ACTION=add   -> agrega los clientes de CLIENTS_JSON (name, phone, nivel).
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});
const db = admin.firestore();

(async () => {
  const action = process.env.ACTION || 'read';

  if (action === 'read') {
    const prices = await db.doc('config/prices').get();
    console.log('===== PRECIOS (config/prices) =====');
    console.log(JSON.stringify(prices.data() || {}, null, 2));

    const clients = await db.collection('clients').get();
    console.log(`\n===== CLIENTES (${clients.size}) =====`);
    clients.forEach((d) => console.log(JSON.stringify({ id: d.id, ...d.data() })));
    return;
  }

  if (action === 'add') {
    const list = JSON.parse(process.env.CLIENTS_JSON || '[]');
    const existing = await db.collection('clients').get();
    const byName = new Set(existing.docs.map((d) => (d.data().name || '').trim().toUpperCase()));

    for (const c of list) {
      const name = String(c.name).trim().toUpperCase();
      if (byName.has(name)) {
        console.log(`OMITIDO (ya existe): ${name}`);
        continue;
      }
      const ref = await db.collection('clients').add({
        name,
        phone: c.phone,
        nivel: c.nivel,
      });
      console.log(`AGREGADO: ${name} | ${c.phone} | nivel ${c.nivel} | id ${ref.id}`);
    }
    return;
  }
})().catch((e) => { console.error(e); process.exit(1); });

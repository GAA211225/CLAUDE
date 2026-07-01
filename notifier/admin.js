// Herramienta de administración de Firestore (se corre desde GitHub Actions).
// ACTION=read   -> imprime precios y clientes.
// ACTION=setup  -> aplica precios de aguas por nivel (+Tamarindo) y agrega/actualiza clientes.
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});
const db = admin.firestore();

// Aguas a $15/$16/$17 por nivel. Taro/Chai/Otro NO se tocan.
const AGUA_TIERS = { n1: 15, n2: 16, n3: 17 };
const AGUAS = ['Piña', 'Jamaica', 'Horchata', 'Tamarindo'];

// Clientes a agregar/actualizar. nivel: 1=$15, 2=$16, 3=$17.
// "match" busca un cliente existente (por nombre o teléfono) para actualizarlo.
const CLIENTS = [
  { name: 'GURROLA BIRRIA', phone: '4922179420', nivel: 1, match: 'GURROLA' },
  { name: 'IVAN HAMBURGUESAS LOPEZ', phone: '4922577775', nivel: 1, match: 'LOPEZ' },
  { name: 'EL CUÑAO 🍔🌭', phone: '4781082091', nivel: 2 },
  { name: 'LETICIA ALVAREZ ELOTES', phone: '4781109798', nivel: 3 },
  { name: 'LIBDALECIO', phone: '4922328536', nivel: 1 },
];

const tail = (p) => String(p || '').replace(/\D/g, '').slice(-10);

(async () => {
  const action = process.env.ACTION || 'read';

  if (action === 'read') {
    const prices = await db.doc('config/prices').get();
    console.log('===== PRECIOS =====');
    console.log(JSON.stringify(prices.data() || {}, null, 2));
    const clients = await db.collection('clients').get();
    console.log(`\n===== CLIENTES (${clients.size}) =====`);
    clients.forEach((d) => console.log(JSON.stringify({ id: d.id, ...d.data() })));
    return;
  }

  if (action === 'setup') {
    // 1) Precios de aguas por nivel (preserva Taro/Chai/Otro).
    const pRef = db.doc('config/prices');
    const cur = (await pRef.get()).data() || {};
    for (const a of AGUAS) cur[a] = { ...AGUA_TIERS };
    await pRef.set(cur);
    console.log('Precios actualizados. Aguas:', AGUAS.join(', '), '->', JSON.stringify(AGUA_TIERS));
    console.log('Sin tocar:', JSON.stringify({ Taro: cur.Taro, Chai: cur.Chai, Otro: cur.Otro }));

    // 2) Clientes (upsert).
    const snap = await db.collection('clients').get();
    for (const c of CLIENTS) {
      let target = null;
      const m = (c.match || '').toUpperCase();
      const t10 = tail(c.phone);
      for (const d of snap.docs) {
        const dn = (d.data().name || '').toUpperCase();
        const dp = tail(d.data().phone);
        if ((m && dn === m) || (t10 && dp && dp === t10)) { target = d; break; }
      }
      if (target) {
        await target.ref.update({ name: c.name, phone: c.phone, nivel: c.nivel });
        console.log(`ACTUALIZADO: ${c.name} | ${c.phone} | nivel ${c.nivel} | id ${target.id}`);
      } else {
        const ref = await db.collection('clients').add({ name: c.name, phone: c.phone, nivel: c.nivel });
        console.log(`AGREGADO: ${c.name} | ${c.phone} | nivel ${c.nivel} | id ${ref.id}`);
      }
    }
    return;
  }
})().catch((e) => { console.error(e); process.exit(1); });

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const sessions = new Map();

// ✅ Schémas
const optionSchema = new mongoose.Schema({ texte: String });
const etapeSchema  = new mongoose.Schema({
  ordre:    Number,
  question: String,
  options:  [optionSchema]
});
const entrepriseSchema = new mongoose.Schema({
  nom:           String,
  numeroWhatsApp:String,
  motdepasse:    String,
  salutation:    String,
  messageRecap:  String,
  etapes:        [etapeSchema],
  actif:         { type: Boolean, default: true }
});
const Entreprise = mongoose.model('Entreprise', entrepriseSchema);

// ✅ Connexion MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  family: 4
}).then(async () => {
  console.log('✅ MongoDB connecté !');
  if (await Entreprise.countDocuments() === 0) {
    await Entreprise.create({
      nom: 'Boutique Test',
      numeroWhatsApp: '212612838772',
      motdepasse: 'test',
      salutation: 'مرحبا بك ! 👋\nقوليا دبا شمن موديل ختريتي',
      messageRecap: 'شكراً ! سنتواصل معك قريباً 😊',
      actif: true,
      etapes: [
        { ordre: 1, question: 'شمن موديل ختريتي ؟', options: [{ texte: 'الموديل 1' }, { texte: 'الموديل 2' }, { texte: 'الموديل 3' }] },
        { ordre: 2, question: 'شمن نمرة ؟',          options: [{ texte: '40' }, { texte: '41' }, { texte: '43' }] }
      ]
    });
    console.log('✅ Données test créées !');
  }
}).catch(err => console.log('❌ MongoDB:', err.message));

// ✅ Webhook verify
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

// ✅ Recevoir messages
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const msgs = req.body.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!msgs?.length) return;

    const msg  = msgs[0];
    const from = msg.from;
    let texte  = '';
    let choix  = null;

    let session = sessions.get(from) || { etat: 'debut', etape: 0, reponses: [] };

    if (msg.type === 'text') {
      texte = msg.text?.body?.trim();
      if (session.etat === 'attente') return; // ignorer texte auto
    } else if (msg.type === 'interactive') {
      if (msg.interactive?.button_reply) {
        texte = msg.interactive.button_reply.id;
        choix = msg.interactive.button_reply.title;
      }
    }

    if (!texte) return;

    const entreprise = await Entreprise.findOne({ actif: true });
    if (!entreprise) return;

    const etapes = [...entreprise.etapes].sort((a, b) => a.ordre - b.ordre);
    const motsStart = ['salam', 'hi', 'hello', 'مرحبا', 'سلام', 'bonjour', 'start', 'بداية', '0', 'menu'];

    // ── START
    if (session.etat === 'debut' || motsStart.includes(texte.toLowerCase())) {
      session = { etat: 'attente', etape: 0, reponses: [] };
      await envoyerMessage(from, entreprise.salutation);
      await sleep(400);
      await envoyerBoutons(from, etapes[0]);
      sessions.set(from, session);

    // ── CHOIX
    } else if (session.etat === 'attente' && choix) {
      const etape = etapes[session.etape];
      session.reponses.push({ question: etape.question, reponse: choix });

      if (session.etape + 1 >= etapes.length) {
        await envoyerRecap(from, entreprise, session.reponses);
        session.etat = 'fin';
      } else {
        session.etape++;
        await sleep(300);
        await envoyerBoutons(from, etapes[session.etape]);
      }
      sessions.set(from, session);

    // ── RECOMMENCER
    } else if (session.etat === 'fin' && (texte === 'restart' || motsStart.includes(texte.toLowerCase()))) {
      session = { etat: 'attente', etape: 0, reponses: [] };
      await envoyerMessage(from, entreprise.salutation);
      await sleep(400);
      await envoyerBoutons(from, etapes[0]);
      sessions.set(from, session);
    }

  } catch (err) { console.error('❌', err.message); }
});

// ✅ Envoyer boutons (max 3 par message)
async function envoyerBoutons(to, etape) {
  const opts = etape.options || [];
  const groupes = [];
  for (let i = 0; i < opts.length; i += 3) groupes.push(opts.slice(i, i + 3));

  for (let g = 0; g < groupes.length; g++) {
    const buttons = groupes[g].map((opt, i) => ({
      type: 'reply',
      reply: { id: `opt_${etape.ordre}_${g * 3 + i}`, title: opt.texte.substring(0, 20) }
    }));
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp', to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: g === 0 ? etape.question : '(تابع الاختيارات)' },
          action: { buttons }
        }
      },
      { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    if (g < groupes.length - 1) await sleep(400);
  }
}

// ✅ Récapitulatif final
async function envoyerRecap(to, entreprise, reponses) {
  let recap = `✅ *تم تسجيل طلبك !*\n\n📋 *ملخص :*\n━━━━━━━━━━━━━\n`;
  reponses.forEach(r => { recap += `\n▪️ *${r.question}*\n   ✔️ ${r.reponse}\n`; });
  recap += `\n━━━━━━━━━━━━━\n💬 ${entreprise.messageRecap}`;

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp', to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: recap },
          action: { buttons: [{ type: 'reply', reply: { id: 'restart', title: '🔄 طلب جديد' } }] }
        }
      },
      { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch { await envoyerMessage(to, recap); }
}

async function envoyerMessage(to, texte) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: texte } },
    { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════
// API
// ═══════════════════════════════════════════
const isAdmin = (req, res, next) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'غير مصرح' });
  next();
};

app.post('/api/auth/login', async (req, res) => {
  try {
    const e = await Entreprise.findOne({ numeroWhatsApp: req.body.numeroWhatsApp, motdepasse: req.body.motdepasse });
    if (!e) return res.status(401).json({ error: 'رقم أو كلمة مرور غير صحيحة' });
    res.json({ entreprise: e });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/entreprises', isAdmin, async (req, res) => {
  try { res.json(await Entreprise.find()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/entreprises', isAdmin, async (req, res) => {
  try {
    const e = await Entreprise.create(req.body);
    res.json({ data: e });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/entreprises/:id', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const clientN  = req.headers['x-client-numero'];
    const clientP  = req.headers['x-client-password'];

    let e = null;
    if (adminKey === process.env.ADMIN_KEY) {
      e = await Entreprise.findById(req.params.id);
    } else if (clientN && clientP) {
      e = await Entreprise.findOne({ _id: req.params.id, numeroWhatsApp: clientN, motdepasse: clientP });
    }
    if (!e) return res.status(403).json({ error: 'غير مصرح' });

    const fields = ['nom','numeroWhatsApp','motdepasse','salutation','messageRecap','actif'];
    fields.forEach(f => { if (req.body[f] !== undefined) e[f] = req.body[f]; });
    if (req.body.etapes !== undefined) {
      e.etapes = req.body.etapes;
      e.markModified('etapes');
    }
    await e.save();
    res.json({ data: e });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/entreprises/:id', isAdmin, async (req, res) => {
  try {
    await Entreprise.findByIdAndDelete(req.params.id);
    res.json({ message: '✅' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log(`🚀 Port ${process.env.PORT || 3000}`));
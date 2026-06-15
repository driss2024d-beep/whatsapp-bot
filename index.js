require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const sessions = new Map();

// ✅ Schéma MongoDB
const optionSchema = new mongoose.Schema({
  texte: String,
  description: String
});

const etapeSchema = new mongoose.Schema({
  ordre: Number,
  titre: String,
  question: String,
  options: [optionSchema]
});

const entrepriseSchema = new mongoose.Schema({
  nom: String,
  numeroWhatsApp: String,
  motdepasse: String,
  salutation: String,
  messageRecap: String,
  etapes: [etapeSchema],
  actif: { type: Boolean, default: true }
});

const Entreprise = mongoose.model('Entreprise', entrepriseSchema);

// ✅ Connexion MongoDB
const connectMongoDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      family: 4,
      retryWrites: true
    });
    console.log('✅ MongoDB connecté !');

    const count = await Entreprise.countDocuments();
    if (count === 0) {
      await Entreprise.create({
        nom: "Boutique Test",
        numeroWhatsApp: "212612838772",
        motdepasse: "boutique123",
        salutation: "مرحبا بك ! 👋\nقوليا دبا شمن موديل ختريتي بش نسجل الطلب ديالك",
        messageRecap: "شكراً على طلبك ! سنتواصل معك قريباً 😊",
        actif: true,
        etapes: [
          {
            ordre: 1,
            titre: "الموديل",
            question: "قوليا دبا شمن موديل ختريتي بش نسجل الطلب ديالك",
            options: [
              { texte: "الموديل 1", description: "" },
              { texte: "الموديل 2", description: "" },
              { texte: "الموديل 3", description: "" }
            ]
          },
          {
            ordre: 2,
            titre: "النمرة",
            question: "مرحبا شمن نمرة بضبط ؟؟",
            options: [
              { texte: "40", description: "" },
              { texte: "41", description: "" },
              { texte: "43", description: "" }
            ]
          }
        ]
      });
      console.log('✅ Données test ajoutées !');
    }
  } catch (err) {
    console.log('❌ Erreur MongoDB:', err.message);
  }
};

connectMongoDB();

// ✅ Webhook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook vérifié !');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ✅ Recevoir les messages
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body.object) return;

    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages || messages.length === 0) return;

    const msg = messages[0];
    const from = msg.from;

    let texteRecu = '';
    let optionChoisie = null;
    let session = sessions.get(from) || {
      etat: 'debut',
      etapeActuelle: 0,
      choix: []
    };

    if (msg.type === 'text') {
      texteRecu = msg.text?.body?.trim();

      // Ignorer messages automatiques
      if (session.etat === 'attente_choix') {
        console.log('⏭️ Ignoré:', texteRecu);
        return;
      }

    } else if (msg.type === 'interactive') {
      if (msg.interactive?.button_reply) {
        texteRecu = msg.interactive.button_reply.id;
        optionChoisie = msg.interactive.button_reply.title;
        console.log(`👆 Bouton: ${optionChoisie}`);
      }
    }

    if (!texteRecu) return;
    console.log(`📩 De ${from}: ${texteRecu}`);

    let entreprise = await Entreprise.findOne({ actif: true });
    if (!entreprise) return;

    const etapes = [...entreprise.etapes].sort((a, b) => a.ordre - b.ordre);
    const motsMenu = ['0', 'menu', 'مرحبا', 'سلام', 'bonjour', 'hi', 'hello', 'السلام', 'restart', 'بداية'];

    // ── DÉMARRER
    if (session.etat === 'debut' || motsMenu.includes(texteRecu.toLowerCase())) {
      session = { etat: 'attente_choix', etapeActuelle: 0, choix: [] };
      sessions.set(from, session);

      if (entreprise.salutation) {
        await envoyerMessage(from, entreprise.salutation);
        await new Promise(r => setTimeout(r, 500));
      }

      if (etapes.length > 0) {
        await envoyerEtapeAvecBoutons(from, etapes[0], etapes.length);
      }

    // ── TRAITER CHOIX BOUTON
    } else if (session.etat === 'attente_choix' && optionChoisie) {
      const etapeIndex = session.etapeActuelle;
      const etape = etapes[etapeIndex];

      session.choix.push({
        etape: etape.titre,
        reponse: optionChoisie
      });

      if (etapeIndex + 1 >= etapes.length) {
        // ✅ RÉCAPITULATIF FINAL
        await envoyerRecap(from, entreprise, session.choix);
        session.etat = 'termine';
      } else {
        // ✅ ÉTAPE SUIVANTE
        session.etapeActuelle = etapeIndex + 1;
        await new Promise(r => setTimeout(r, 300));
        await envoyerEtapeAvecBoutons(from, etapes[session.etapeActuelle], etapes.length);
      }

    // ── RECOMMENCER
    } else if (session.etat === 'termine') {
      if (texteRecu === 'restart' || motsMenu.includes(texteRecu.toLowerCase())) {
        session = { etat: 'attente_choix', etapeActuelle: 0, choix: [] };
        sessions.set(from, session);
        await envoyerMessage(from, entreprise.salutation);
        await new Promise(r => setTimeout(r, 500));
        await envoyerEtapeAvecBoutons(from, etapes[0], etapes.length);
      }
    }

    sessions.set(from, session);

  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
});

// ✅ Envoyer étape avec boutons REPLY (style QChat)
// WhatsApp limite à 3 boutons max par message
// Si plus de 3 options → envoyer plusieurs messages
async function envoyerEtapeAvecBoutons(to, etape, totalEtapes) {
  try {
    const options = etape.options || [];

    if (options.length === 0) {
      await envoyerMessage(to, `⚠️ لا توجد خيارات في هذه الخطوة`);
      return;
    }

    // Découper en groupes de 3 (limite WhatsApp)
    const groupes = [];
    for (let i = 0; i < options.length; i += 3) {
      groupes.push(options.slice(i, i + 3));
    }

    // Envoyer chaque groupe
    for (let g = 0; g < groupes.length; g++) {
      const groupe = groupes[g];
      const isFirst = g === 0;
      const isLast  = g === groupes.length - 1;

      const buttons = groupe.map((opt, i) => ({
        type: 'reply',
        reply: {
          id: `opt_${etape.ordre}_${(g * 3) + i}`,
          title: opt.texte.substring(0, 20) // Max 20 chars pour les boutons
        }
      }));

      // Corps du message
      const bodyText = isFirst
        ? `${etape.question}`
        : `(تابع الاختيارات)`;

      await axios.post(
        `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to: to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: bodyText },
            action: { buttons }
          }
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Petit délai entre les messages
      if (!isLast) await new Promise(r => setTimeout(r, 400));
    }

    console.log(`✅ Étape ${etape.ordre} envoyée avec boutons`);

  } catch (err) {
    console.error('❌ Erreur boutons:', err.response?.data || err.message);

    // Fallback: envoyer en texte numéroté
    let menu = `*${etape.question}*\n\n`;
    (etape.options || []).forEach((opt, i) => {
      menu += `${i + 1}. ${opt.texte}\n`;
    });
    menu += `\nاكتب رقم اختيارك 👇`;
    await envoyerMessage(to, menu);
  }
}

// ✅ Envoyer récapitulatif final
async function envoyerRecap(to, entreprise, choix) {
  try {
    let recap = `✅ *تم تسجيل طلبك !*\n\n`;
    recap += `📋 *ملخص الطلب :*\n`;
    recap += `━━━━━━━━━━━━━━━\n`;
    choix.forEach((c, i) => {
      recap += `\n*${c.etape}* : ${c.reponse}`;
    });
    recap += `\n\n━━━━━━━━━━━━━━━\n`;
    recap += `💬 ${entreprise.messageRecap}`;

    // Envoyer avec bouton recommencer
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: recap },
          action: {
            buttons: [{
              type: 'reply',
              reply: { id: 'restart', title: '🔄 طلب جديد' }
            }]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ Récap envoyé à ${to}`);

  } catch (err) {
    console.error('❌ Erreur recap:', err.response?.data || err.message);
    let recap = `✅ *تم تسجيل طلبك !*\n━━━━━━━━━━━━━━━\n`;
    choix.forEach(c => { recap += `\n• ${c.etape} : ${c.reponse}`; });
    recap += `\n\n💬 ${entreprise.messageRecap}`;
    await envoyerMessage(to, recap);
  }
}

// ✅ Envoyer message texte simple
async function envoyerMessage(to, texte) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: texte }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error('❌ Erreur message:', err.response?.data || err.message);
  }
}

// ✅ Middleware Admin
const isAdmin = (req, res, next) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  next();
};

// ✅ API Auth Client
app.post('/api/auth/login', async (req, res) => {
  try {
    const { numeroWhatsApp, motdepasse } = req.body;
    const entreprise = await Entreprise.findOne({ numeroWhatsApp, motdepasse });
    if (!entreprise) return res.status(401).json({ error: 'رقم أو كلمة مرور غير صحيحة' });
    res.json({ message: '✅', entreprise });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ API Entreprises
app.get('/api/entreprises', isAdmin, async (req, res) => {
  try { res.json(await Entreprise.find()); }
  catch (err) { res.json({ error: err.message }); }
});

app.post('/api/entreprises', isAdmin, async (req, res) => {
  try {
    const e = new Entreprise(req.body);
    await e.save();
    res.json({ message: '✅', data: e });
  } catch (err) { res.json({ error: err.message }); }
});

// ✅ PUT — FIX PRINCIPAL avec markModified
app.put('/api/entreprises/:id', async (req, res) => {
  try {
    const adminKey       = req.headers['x-admin-key'];
    const clientNumero   = req.headers['x-client-numero'];
    const clientPassword = req.headers['x-client-password'];

    let entreprise = null;

    if (adminKey === process.env.ADMIN_KEY) {
      entreprise = await Entreprise.findById(req.params.id);
    } else if (clientNumero && clientPassword) {
      entreprise = await Entreprise.findOne({
        _id: req.params.id,
        numeroWhatsApp: clientNumero,
        motdepasse: clientPassword
      });
    }

    if (!entreprise) return res.status(403).json({ error: 'غير مصرح' });

    // Mettre à jour les champs
    if (req.body.nom          !== undefined) entreprise.nom          = req.body.nom;
    if (req.body.numeroWhatsApp !== undefined) entreprise.numeroWhatsApp = req.body.numeroWhatsApp;
    if (req.body.motdepasse   !== undefined) entreprise.motdepasse   = req.body.motdepasse;
    if (req.body.salutation   !== undefined) entreprise.salutation   = req.body.salutation;
    if (req.body.messageRecap !== undefined) entreprise.messageRecap = req.body.messageRecap;
    if (req.body.actif        !== undefined) entreprise.actif        = req.body.actif;

    // ✅ FIX: markModified pour les tableaux imbriqués
    if (req.body.etapes !== undefined) {
      entreprise.etapes = req.body.etapes;
      entreprise.markModified('etapes');
    }

    await entreprise.save();
    console.log('✅ Sauvegardé:', entreprise.nom, '| Étapes:', entreprise.etapes.length);

    res.json({ message: '✅', data: entreprise });

  } catch (err) {
    console.error('❌ PUT Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/entreprises/:id', isAdmin, async (req, res) => {
  try {
    await Entreprise.findByIdAndDelete(req.params.id);
    res.json({ message: '✅ Supprimé !' });
  } catch (err) { res.json({ error: err.message }); }
});

// ✅ Démarrer serveur
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Bot démarré sur port ${process.env.PORT || 3000}`);
});
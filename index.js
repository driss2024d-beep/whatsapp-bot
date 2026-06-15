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
        salutation: "مرحبا بك ! 👋 سنساعدك في اختيار المنتج المناسب",
        messageRecap: "شكراً على اختياراتك ! سنتواصل معك قريباً 😊",
        actif: true,
        etapes: [
          {
            ordre: 1,
            titre: "نوع المنتج",
            question: "اختر نوع المنتج الذي تبحث عنه :",
            options: [
              { texte: "قفطان", description: "قفاطن تقليدية وعصرية" },
              { texte: "جلابة", description: "جلابة رجالية ونسائية" },
              { texte: "تكشيطة", description: "تكشيطة للمناسبات" }
            ]
          },
          {
            ordre: 2,
            titre: "المقاس",
            question: "اختر مقاسك :",
            options: [
              { texte: "S — صغير", description: "للأشخاص النحيفين" },
              { texte: "M — وسط", description: "المقاس الأكثر طلباً" },
              { texte: "L — كبير", description: "للأشخاص العاديين" },
              { texte: "XL — كبير جداً", description: "للأشخاص الضخام" }
            ]
          },
          {
            ordre: 3,
            titre: "الميزانية",
            question: "ما هي ميزانيتك ؟",
            options: [
              { texte: "500-1000 درهم", description: "جودة عالية بسعر مناسب" },
              { texte: "1000-2000 درهم", description: "جودة ممتازة" },
              { texte: "أكثر من 2000 درهم", description: "الفاخرة والمطرزة" }
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

// ✅ Recevoir les messages WhatsApp
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
      if (session.etat === 'attente_choix') {
        console.log('⏭️ Message ignoré:', texteRecu);
        return;
      }
    } else if (msg.type === 'interactive') {
      if (msg.interactive?.list_reply) {
        texteRecu = msg.interactive.list_reply.id;
        optionChoisie = msg.interactive.list_reply.title;
        console.log(`👆 Option: ${optionChoisie}`);
      } else if (msg.interactive?.button_reply) {
        texteRecu = msg.interactive.button_reply.id;
        console.log(`👆 Bouton: ${texteRecu}`);
      }
    }

    if (!texteRecu) return;

    console.log(`📩 De ${from}: ${texteRecu}`);

    let entreprise = await Entreprise.findOne({ actif: true });
    if (!entreprise) return;

    const etapes = [...entreprise.etapes].sort((a, b) => a.ordre - b.ordre);
    const motsMenu = ['0', 'menu', 'مرحبا', 'سلام', 'bonjour', 'hi', 'hello', 'السلام', 'restart'];

    // ── DÉMARRER
    if (session.etat === 'debut' || motsMenu.includes(texteRecu.toLowerCase())) {
      session = { etat: 'attente_choix', etapeActuelle: 0, choix: [] };
      sessions.set(from, session);
      await envoyerMessage(from, `*${entreprise.salutation}*`);
      await new Promise(r => setTimeout(r, 500));
      if (etapes.length > 0) {
        await envoyerEtape(from, etapes[0], etapes.length);
      } else {
        await envoyerMessage(from, 'لا توجد خطوات متاحة حالياً.');
      }

    // ── TRAITER CHOIX
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
        await envoyerMessage(from, `✅ *اخترت :* ${optionChoisie}`);
        await new Promise(r => setTimeout(r, 600));
        await envoyerEtape(from, etapes[session.etapeActuelle], etapes.length);
      }

    // ── RECOMMENCER
    } else if (session.etat === 'termine' && texteRecu === 'restart_quiz') {
      session = { etat: 'attente_choix', etapeActuelle: 0, choix: [] };
      await envoyerMessage(from, `*${entreprise.salutation}*`);
      await new Promise(r => setTimeout(r, 500));
      await envoyerEtape(from, etapes[0], etapes.length);
    }

    sessions.set(from, session);

  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
});

// ✅ Envoyer une étape
async function envoyerEtape(to, etape, totalEtapes) {
  try {
    const rows = (etape.options || []).map((opt, i) => ({
      id: `opt_${etape.ordre}_${i}`,
      title: opt.texte.substring(0, 24),
      description: (opt.description || '').substring(0, 72)
    }));

    if (rows.length === 0) {
      await envoyerMessage(to, `⚠️ لا توجد خيارات في هذه الخطوة`);
      return;
    }

    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: {
            type: 'text',
            text: `📋 الخطوة ${etape.ordre} من ${totalEtapes}`
          },
          body: { text: etape.question },
          footer: { text: 'اختر من القائمة 👇' },
          action: {
            button: `📌 ${etape.titre}`,
            sections: [{
              title: etape.titre,
              rows: rows
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
    console.log(`✅ Étape ${etape.ordre} envoyée`);
  } catch (err) {
    console.error('❌ Erreur étape:', err.response?.data || err.message);
    let menu = `*${etape.question}*\n\n`;
    (etape.options || []).forEach((opt, i) => {
      menu += `${i + 1}. ${opt.texte}\n`;
    });
    await envoyerMessage(to, menu);
  }
}

// ✅ Envoyer récapitulatif
async function envoyerRecap(to, entreprise, choix) {
  try {
    let recap = `🎉 *شكراً على اختياراتك !*\n\n`;
    recap += `📋 *ملخص اختياراتك :*\n`;
    recap += `━━━━━━━━━━━━━━━\n\n`;
    choix.forEach((c, i) => {
      recap += `*${i + 1}. ${c.etape}*\n`;
      recap += `   ✅ ${c.reponse}\n\n`;
    });
    recap += `━━━━━━━━━━━━━━━\n`;
    recap += `💬 ${entreprise.messageRecap}`;

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
              reply: { id: 'restart_quiz', title: '🔄 البدء من جديد' }
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
    console.log(`✅ Récap envoyé`);
  } catch (err) {
    console.error('❌ Erreur recap:', err.response?.data || err.message);
    let recap = `🎉 *ملخص اختياراتك :*\n━━━━━━━━━━━━━━━\n\n`;
    choix.forEach((c, i) => {
      recap += `${i + 1}. *${c.etape}* : ${c.reponse}\n`;
    });
    recap += `\n💬 ${entreprise.messageRecap}`;
    await envoyerMessage(to, recap);
  }
}

// ✅ Envoyer message texte
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

// ✅ API Auth
app.post('/api/auth/login', async (req, res) => {
  try {
    const { numeroWhatsApp, motdepasse } = req.body;
    const entreprise = await Entreprise.findOne({ numeroWhatsApp, motdepasse });
    if (!entreprise) return res.status(401).json({ error: 'رقم أو كلمة مرور غير صحيحة' });
    res.json({ message: '✅ تم تسجيل الدخول !', entreprise });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET toutes les entreprises (admin)
app.get('/api/entreprises', isAdmin, async (req, res) => {
  try {
    res.json(await Entreprise.find());
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ✅ POST ajouter entreprise (admin)
app.post('/api/entreprises', isAdmin, async (req, res) => {
  try {
    const e = new Entreprise(req.body);
    await e.save();
    res.json({ message: '✅ Ajouté !', data: e });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ✅ PUT modifier entreprise — FIX PRINCIPAL
app.put('/api/entreprises/:id', async (req, res) => {
  try {
    const adminKey       = req.headers['x-admin-key'];
    const clientNumero   = req.headers['x-client-numero'];
    const clientPassword = req.headers['x-client-password'];

    let entreprise = null;

    // Vérifier Admin
    if (adminKey === process.env.ADMIN_KEY) {
      entreprise = await Entreprise.findById(req.params.id);
    }
    // Vérifier Client
    else if (clientNumero && clientPassword) {
      entreprise = await Entreprise.findOne({
        _id: req.params.id,
        numeroWhatsApp: clientNumero,
        motdepasse: clientPassword
      });
    }

    if (!entreprise) {
      return res.status(403).json({ error: 'غير مصرح أو غير موجود' });
    }

    // ✅ FIX: Mettre à jour chaque champ manuellement
    if (req.body.nom !== undefined) entreprise.nom = req.body.nom;
    if (req.body.numeroWhatsApp !== undefined) entreprise.numeroWhatsApp = req.body.numeroWhatsApp;
    if (req.body.motdepasse !== undefined) entreprise.motdepasse = req.body.motdepasse;
    if (req.body.salutation !== undefined) entreprise.salutation = req.body.salutation;
    if (req.body.messageRecap !== undefined) entreprise.messageRecap = req.body.messageRecap;
    if (req.body.actif !== undefined) entreprise.actif = req.body.actif;

    // ✅ FIX PRINCIPAL: Sauvegarder les étapes correctement
    if (req.body.etapes !== undefined) {
      entreprise.etapes = req.body.etapes;
    }

    // ✅ Marquer etapes comme modifié (important pour Mongoose)
    entreprise.markModified('etapes');

    // ✅ Sauvegarder avec save() au lieu de findByIdAndUpdate
    await entreprise.save();

    console.log('✅ Entreprise sauvegardée:', entreprise.nom, '| Étapes:', entreprise.etapes.length);

    res.json({ message: '✅ Modifié !', data: entreprise });

  } catch (err) {
    console.error('❌ Erreur PUT:', err.message);
    res.json({ error: err.message });
  }
});

// ✅ DELETE supprimer entreprise (admin)
app.delete('/api/entreprises/:id', isAdmin, async (req, res) => {
  try {
    await Entreprise.findByIdAndDelete(req.params.id);
    res.json({ message: '✅ Supprimé !' });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ✅ Route de test pour vérifier les étapes
app.get('/api/test/:id', isAdmin, async (req, res) => {
  try {
    const e = await Entreprise.findById(req.params.id);
    res.json({
      nom: e.nom,
      etapesCount: e.etapes.length,
      etapes: e.etapes
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ✅ Démarrer serveur
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Bot démarré sur port ${process.env.PORT || 3000}`);
  console.log(`✅ Webhook: http://localhost:${process.env.PORT || 3000}/webhook`);
});
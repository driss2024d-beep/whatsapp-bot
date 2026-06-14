require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const sessions = new Map();

// ✅ Schéma MongoDB avec description et audio
const questionSchema = new mongoose.Schema({
  question: String,
  description: String,
  reponse: String,
  audioUrl: String
});

const sectionSchema = new mongoose.Schema({
  titre: String,
  questions: [questionSchema]
});

const entrepriseSchema = new mongoose.Schema({
  nom: String,
  numeroWhatsApp: String,
  motdepasse: String,        // ← NOUVEAU : mot de passe client dashboard
  salutation: String,
  sections: [sectionSchema],
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
        motdepasse: "boutique123",   // ← mot de passe par défaut pour le test
        salutation: "مرحبا بك ! 👋 كيف يمكنني مساعدتك ؟",
        actif: true,
        sections: [
          {
            titre: "معلومات عامة",
            questions: [
              {
                question: "شحال ثمن الخدمة",
                description: "شحال ثمن الخدمة واش لشهر ولا العام",
                reponse: "الخدمة ديالنا تبدا من 200 درهم فالشهر",
                audioUrl: ""
              },
              {
                question: "فين كاينين",
                description: "العنوان ديالنا وكيفاش توصل لينا",
                reponse: "كاينين فمكناس، المغرب",
                audioUrl: ""
              },
              {
                question: "شنو هي أوقات العمل",
                description: "أوقات فتح الدكان",
                reponse: "من 9 الصباح حتى 6 العشية",
                audioUrl: ""
              }
            ]
          },
          {
            titre: "الدعم التقني",
            questions: [
              {
                question: "كيفاش نتواصل معاكم",
                description: "طرق التواصل معانا",
                reponse: "يمكنك الاتصال بنا على: 0600000000",
                audioUrl: ""
              },
              {
                question: "واش كاين توصيل",
                description: "التوصيل الى البيت",
                reponse: "يه ! التوصيل متاح لجميع مدن المغرب",
                audioUrl: ""
              }
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
    let session = sessions.get(from) || { etat: 'debut', questions: [] };

    if (msg.type === 'text') {
      texteRecu = msg.text?.body?.trim();

      if (session.etat === 'attente_choix') {
        console.log('⏭️ Message ignoré (clic sur la liste):', texteRecu);
        return;
      }

    } else if (msg.type === 'interactive') {
      if (msg.interactive?.list_reply) {
        const index = parseInt(msg.interactive.list_reply.id.replace('q_', ''));
        texteRecu = (index + 1).toString();
        console.log(`👆 Liste cliquée: ${msg.interactive.list_reply.title}`);
      } else if (msg.interactive?.button_reply) {
        texteRecu = msg.interactive.button_reply.id;
        console.log(`👆 Bouton cliqué: ${msg.interactive.button_reply.title}`);
      }
    }

    if (!texteRecu) return;

    console.log(`📩 De ${from}: ${texteRecu}`);

    // ✅ Chercher l'entreprise par numéro WhatsApp du destinataire
    let entreprise = await Entreprise.findOne({ actif: true });
    if (!entreprise) return;

    const motsMenu = ['0', 'menu', 'مرحبا', 'سلام', 'bonjour',
                      'hi', 'hello', 'back_menu', 'السلام'];

    if (session.etat === 'debut' || motsMenu.includes(texteRecu.toLowerCase())) {
      session.questions = [];
      entreprise.sections.forEach(section => {
        section.questions.forEach(q => session.questions.push(q));
      });
      await envoyerMenu(from, entreprise, session.questions);
      session.etat = 'attente_choix';

    } else if (session.etat === 'attente_choix') {
      const choix = parseInt(texteRecu);

      if (choix && choix > 0 && choix <= session.questions.length) {
        const q = session.questions[choix - 1];

        if (q.audioUrl && q.audioUrl.trim() !== '') {
          await envoyerAudio(from, q.audioUrl, q.question, q.reponse);
        } else {
          await envoyerReponse(from, q);
        }

      } else {
        await envoyerMessage(from,
          `❌ اختيار غير صحيح\nاكتب رقم بين 1 و ${session.questions.length}\nأو اكتب 0 للقائمة`
        );
      }
    }

    sessions.set(from, session);

  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
});

// ✅ Envoyer menu interactif avec descriptions
async function envoyerMenu(to, entreprise, questions) {
  try {
    const sections = entreprise.sections.map(section => ({
      title: section.titre.substring(0, 24),
      rows: section.questions.map(q => ({
        id: `q_${questions.indexOf(q)}`,
        title: q.question.substring(0, 24),
        description: (q.description || q.reponse).substring(0, 72)
      }))
    }));

    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: `🤖 ${entreprise.nom}` },
          body: { text: entreprise.salutation },
          footer: { text: 'اختر سؤالك من القائمة 👇' },
          action: {
            button: '📋 الأسئلة الشائعة',
            sections: sections
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
    console.log(`✅ Menu envoyé à ${to}`);
  } catch (err) {
    console.error('❌ Erreur menu:', err.response?.data || err.message);
    await envoyerMenuTexte(to, entreprise, questions);
  }
}

// ✅ Envoyer réponse texte avec bouton retour
async function envoyerReponse(to, q) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: `*${q.question}*\n\n💬 ${q.reponse}` },
          action: {
            buttons: [{
              type: 'reply',
              reply: { id: 'back_menu', title: '🔙 الرجوع للقائمة' }
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
  } catch (err) {
    await envoyerMessage(to,
      `*${q.question}*\n\n💬 ${q.reponse}\n\n_اكتب 0 للقائمة_ 👇`
    );
  }
}

// ✅ Envoyer réponse AUDIO
async function envoyerAudio(to, audioUrl, question, reponse) {
  try {
    await envoyerMessage(to, `*${question}*`);
    await new Promise(r => setTimeout(r, 500));

    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'audio',
        audio: { link: audioUrl }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    await new Promise(r => setTimeout(r, 500));

    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: `💬 ${reponse}` },
          action: {
            buttons: [{
              type: 'reply',
              reply: { id: 'back_menu', title: '🔙 الرجوع للقائمة' }
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

    console.log(`✅ Audio envoyé à ${to}`);
  } catch (err) {
    console.error('❌ Erreur audio:', err.response?.data || err.message);
    await envoyerReponse(to, { question, reponse });
  }
}

// ✅ Menu texte backup
async function envoyerMenuTexte(to, entreprise, questions) {
  let menu = `*${entreprise.salutation}*\n\n`;
  menu += `🤖 *FAQ — ${entreprise.nom}*\n━━━━━━━━━━━━━━━\n\n`;
  let numero = 1;
  entreprise.sections.forEach(section => {
    menu += `📌 *${section.titre}*\n`;
    section.questions.forEach(q => {
      menu += `${numero}. ${q.question}\n`;
      if (q.description) menu += `   📝 ${q.description}\n`;
      numero++;
    });
    menu += '\n';
  });
  menu += `━━━━━━━━━━━━━━━\n_اكتب رقم سؤالك_ 👇`;
  await envoyerMessage(to, menu);
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

// ✅ API Admin
app.get('/api/entreprises', async (req, res) => {
  try { res.json(await Entreprise.find()); }
  catch (err) { res.json({ error: err.message }); }
});

app.post('/api/entreprises', async (req, res) => {
  try {
    const e = new Entreprise(req.body);
    await e.save();
    res.json({ message: '✅ Ajouté !', data: e });
  } catch (err) { res.json({ error: err.message }); }
});

app.put('/api/entreprises/:id', async (req, res) => {
  try {
    const e = await Entreprise.findByIdAndUpdate(
      req.params.id, req.body, { new: true }
    );
    res.json({ message: '✅ Modifié !', data: e });
  } catch (err) { res.json({ error: err.message }); }
});

app.delete('/api/entreprises/:id', async (req, res) => {
  try {
    await Entreprise.findByIdAndDelete(req.params.id);
    res.json({ message: '✅ Supprimé !' });
  } catch (err) { res.json({ error: err.message }); }
});

// ✅ Démarrer serveur
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Bot démarré sur port ${process.env.PORT || 3000}`);
  console.log(`✅ Webhook: http://localhost:${process.env.PORT || 3000}/webhook`);
});
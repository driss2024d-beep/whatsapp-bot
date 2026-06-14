const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  id: String,
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
  motdepasse: String,        // ← NOUVEAU : mot de passe du client
  salutation: String,
  sections: [sectionSchema],
  actif: { type: Boolean, default: true }
});

module.exports = mongoose.model('Entreprise', entrepriseSchema);
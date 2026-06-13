const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  id: String,
  question: String,
  reponse: String
});

const sectionSchema = new mongoose.Schema({
  titre: String,
  questions: [questionSchema]
});

const entrepriseSchema = new mongoose.Schema({
  nom: String,
  numeroWhatsApp: String,
  salutation: String,
  sections: [sectionSchema],
  actif: { type: Boolean, default: true }
});

module.exports = mongoose.model('Entreprise', entrepriseSchema);
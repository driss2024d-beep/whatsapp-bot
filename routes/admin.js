const express = require('express');
const router = express.Router();
const Entreprise = require('../models/entreprise');

// Voir toutes les entreprises
router.get('/api/entreprises', async (req, res) => {
  const data = await Entreprise.find();
  res.json(data);
});

// Ajouter une entreprise
router.post('/api/entreprises', async (req, res) => {
  const e = new Entreprise(req.body);
  await e.save();
  res.json({ message: '✅ Ajouté !', data: e });
});

// Modifier
router.put('/api/entreprises/:id', async (req, res) => {
  const e = await Entreprise.findByIdAndUpdate(
    req.params.id, req.body, { new: true }
  );
  res.json({ message: '✅ Modifié !', data: e });
});

// Supprimer
router.delete('/api/entreprises/:id', async (req, res) => {
  await Entreprise.findByIdAndDelete(req.params.id);
  res.json({ message: '✅ Supprimé !' });
});

module.exports = router;
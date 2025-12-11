// src/routes/clearMovimentos.js
import express from 'express';
import { clearMovimentos } from '../controllers/adminClearMovimentosController.js';
import { ensureAdmin } from '../middleware/auth.js'; // ajuste se necessário

const router = express.Router();
router.post('/financeiro/movimentos/clear', ensureAdmin, clearMovimentos);
export default router;

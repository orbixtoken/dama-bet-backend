// routes/admin/clearMovimentos.js
import express from 'express';
import { clearMovimentos } from '../../controllers/adminClearMovimentosController.js';
import { ensureAdmin } from '../../middleware/auth.js'; // ajuste se o nome for outro

const router = express.Router();

// POST /api/admin/financeiro/movimentos/clear
router.post('/financeiro/movimentos/clear', ensureAdmin, clearMovimentos);

export default router;

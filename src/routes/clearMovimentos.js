import express from 'express';
import { clearMovimentos } from '../controllers/adminClearMovimentosController.js';
import { ensureAdmin } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/financeiro/movimentos/clear', ensureAdmin, clearMovimentos);

export default router;

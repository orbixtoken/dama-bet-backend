// src/routes/clearMovimentos.js
import express from 'express';
import { clearMovimentos } from '../controllers/adminClearMovimentosController.js';
import { autorizarRoles } from '../middlewares/auth.middleware.js'; 

// Cria o middleware ensureAdmin usando autorizarRoles
const ensureAdmin = autorizarRoles('ADMIN');

const router = express.Router();

// Rota protegida apenas para ADMIN
router.post('/financeiro/movimentos/clear', ensureAdmin, clearMovimentos);

export default router;

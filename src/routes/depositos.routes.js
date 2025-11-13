// src/routes/depositos.routes.js
import { Router } from 'express';
import { autenticarToken } from '../middlewares/auth.middleware.js';
// se você tem middleware de role, pode usar aqui (ex.: exigirAdmin)
import {
  criarDeposito,
  listarMeusDepositos,
  listarDepositosAdmin,
  atualizarStatusDeposito,
} from '../controllers/depositos.controller.js';

const router = Router();

/* SITE */
router.post('/depositos', autenticarToken, criarDeposito);
router.get('/depositos/meus', autenticarToken, listarMeusDepositos);

/* ADMIN */
router.get('/admin/depositos', autenticarToken, listarDepositosAdmin);
router.patch('/admin/depositos/:id/status', autenticarToken, atualizarStatusDeposito);

export default router;

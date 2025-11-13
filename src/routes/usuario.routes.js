// src/routes/usuario.routes.js
import express from 'express';
import { resetSenhaLimiter } from '../utils/rateLimiter.js';
import {
  // ⚠️ Removemos loginUsuario daqui (login agora em /api/auth/login)
  cadastrarUsuario,
  atualizarPerfil,
  alterarSenha,
  resetarSenha,
  validarCpfEndpoint,
  getMeuPerfil,
  atualizarUsuario, // ✅ usar para admin atualizar qualquer usuário
} from '../controllers/usuario.controller.js';
import { autenticarToken, autorizarRoles } from '../middlewares/auth.middleware.js';

const router = express.Router();

/* =========================
   📌 ROTAS PÚBLICAS
   ========================= */

// Ping
router.get('/', (_req, res) => {
  res.json({ ok: true, rota: 'usuarios' });
});

// Cadastro de novo usuário
router.post('/cadastrar', cadastrarUsuario);

// Validação de CPF
router.post('/validar-cpf', validarCpfEndpoint);

/* =========================
   🔒 ROTAS PRIVADAS (JWT)
   ========================= */

// Perfil do próprio usuário
router.get('/me', autenticarToken, getMeuPerfil);

// Atualizar perfil do próprio usuário
router.put('/me', autenticarToken, atualizarPerfil);

// Alterar a própria senha
router.put('/senha', autenticarToken, alterarSenha);

/* =========================
   👑 ROTAS ADMIN
   ========================= */

// Admin atualiza qualquer usuário por ID
router.put('/:id', autenticarToken, autorizarRoles('ADMIN'), atualizarUsuario);

// Admin reseta senha de qualquer usuário
router.put(
  '/resetar-senha',
  autenticarToken,
  autorizarRoles('ADMIN'),
  resetSenhaLimiter,
  resetarSenha
);

export default router;

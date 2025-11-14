// src/routes/auth.routes.js
import { Router } from 'express';
import {
  signupUsuario,
  loginUsuario,
  refreshToken,
  logout,
  logoutAll,
} from '../controllers/auth.controller.js';
import { autenticarToken } from '../middlewares/auth.middleware.js';
import { loginLimiter } from '../utils/rateLimiter.js';
import db from '../models/db.js';

const router = Router();

/** Helper de validação de campos obrigatórios no body */
const requireBody = (fields = []) => (req, res, next) => {
  const faltando = fields.filter(
    (f) =>
      req.body[f] === undefined ||
      req.body[f] === null ||
      req.body[f] === ''
  );
  if (faltando.length) {
    return res.status(400).json({
      erro: `Campos obrigatórios faltando: ${faltando.join(', ')}.`,
    });
  }
  next();
};

/**
 * @openapi
 * /api/auth/check-email:
 *   get:
 *     summary: Verifica se um usuário (e-mail de login) já está cadastrado
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *         description: E-mail de login a verificar (usado como "usuario")
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: Query param ausente/ inválido
 */
router.get('/check-email', async (req, res) => {
  // Aceita ?email= ou ?usuario= mas trata tudo como "usuario" (coluna unica)
  const usuarioRaw = (
    req.query?.email ||
    req.query?.usuario ||
    ''
  )
    .toString()
    .trim()
    .toLowerCase();

  if (!usuarioRaw || !/\S+@\S+\.\S+/.test(usuarioRaw)) {
    return res.status(400).json({ erro: 'Parâmetro "email" inválido.' });
  }

  try {
    const { rows } = await db.query(
      `SELECT 1
         FROM public.usuarios
        WHERE LOWER(usuario) = $1
        LIMIT 1`,
      [usuarioRaw]
    );
    return res.json({ available: rows.length === 0 });
  } catch (e) {
    console.error('check-email erro:', e);
    // Em caso de erro, não travar UX: assume disponível
    return res.status(200).json({ available: true });
  }
});

/**
 * @openapi
 * /api/auth/signup:
 *   post:
 *     summary: Cria conta e já retorna tokens (login automático)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nome, usuario, senha]
 *             properties:
 *               nome:
 *                 type: string
 *                 example: "Maria Souza"
 *               usuario:
 *                 type: string
 *                 example: "maria@exemplo.com"
 *                 description: E-mail usado como usuário de login
 *               senha:
 *                 type: string
 *                 example: "minhaSenha123"
 *     responses:
 *       201:
 *         description: Conta criada
 *       400:
 *         description: Body inválido
 *       409:
 *         description: Usuário já cadastrado
 */
router.post(
  '/signup',
  requireBody(['nome', 'usuario', 'senha']),
  signupUsuario
);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Autentica o usuário e emite accessToken + refreshToken
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: OK — tokens emitidos
 *       400:
 *         description: Body inválido (campos faltando)
 *       401:
 *         description: Credenciais inválidas
 *       429:
 *         description: Muitas tentativas de login
 */
router.post(
  '/login',
  loginLimiter,
  requireBody(['usuario', 'senha']),
  loginUsuario
);

/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     summary: Rotaciona o refresh token e retorna novo par de tokens
 *     tags: [Auth]
 */
router.post('/refresh', requireBody(['refreshToken']), refreshToken);

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     summary: Logout da sessão atual (revoga o refresh token informado)
 *     tags: [Auth]
 */
router.post('/logout', requireBody(['refreshToken']), logout);

/**
 * @openapi
 * /api/auth/logout-all:
 *   post:
 *     summary: Logout global — revoga todos os refresh tokens do usuário autenticado
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
router.post('/logout-all', autenticarToken, logoutAll);

export default router;

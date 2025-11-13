// src/routes/resetSenha.routes.js
import { Router } from 'express';
import { atualizarSenha } from '../controllers/resetSenhaController.js';
import { autenticarToken } from '../middlewares/auth.middleware.js';
import { resetSenhaLimiter } from '../utils/rateLimiter.js';

const router = Router();

/** Valida campos obrigatórios no body */
const requireBody = (fields = []) => (req, res, next) => {
  const faltando = fields.filter(
    (f) => req.body[f] === undefined || req.body[f] === null || req.body[f] === ''
  );
  if (faltando.length) {
    return res.status(400).json({ erro: `Campos obrigatórios faltando: ${faltando.join(', ')}` });
  }
  next();
};

/**
 * @openapi
 * /api/reset-senha/redefinir-senha:
 *   put:
 *     summary: Redefine a senha do usuário autenticado
 *     tags: [Usuários]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [novaSenha]
 *             properties:
 *               novaSenha:
 *                 type: string
 *                 minLength: 6
 *                 example: NovaSenha123
 *     responses:
 *       200: { description: Senha redefinida com sucesso }
 *       400: { description: Body inválido (novaSenha ausente ou curta) }
 *       401: { description: Não autenticado }
 *       500: { description: Erro interno }
 */
router.put(
  '/redefinir-senha',
  autenticarToken,           // precisa estar logado
  resetSenhaLimiter,         // evita abuso (3/h, conforme teu rateLimiter)
  requireBody(['novaSenha']),
  atualizarSenha
);

export default router;

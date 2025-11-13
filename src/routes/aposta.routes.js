// src/routes/aposta.routes.js
import { Router } from 'express';
import { autenticarToken, autorizarRoles } from '../middlewares/auth.middleware.js';
import {
  criarAposta,
  listarMinhasApostas,
  atualizarResultado,
  listarTodasApostas,
} from '../controllers/apostaController.js';

const router = Router();

/** Valida campos obrigatórios no body */
const requireBody = (fields = []) => (req, res, next) => {
  const faltando = fields.filter((f) => {
    const v = req.body?.[f];
    return v === undefined || v === null || v === '';
  });
  if (faltando.length) {
    return res.status(400).json({ erro: `Campos obrigatórios faltando: ${faltando.join(', ')}` });
  }
  next();
};

/** Middleware simples para validar params numéricos (ex.: ":id"). */
const requireIntParam = (paramName) => (req, res, next) => {
  const raw = req.params[paramName];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return res.status(400).json({ erro: `Parâmetro inválido: ${paramName}` });
  }
  next();
};

/**
 * @openapi
 * /api/apostas:
 *   post:
 *     tags: [Apostas]
 *     summary: Criar nova aposta
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tipo_jogo, valor_apostado]
 *             properties:
 *               tipo_jogo: { type: string, example: "roleta" }
 *               valor_apostado: { type: number, example: 50 }
 *               retorno_esperado: { type: number, example: 95 }
 *     responses:
 *       201: { description: Aposta criada. }
 *       400: { description: Dados inválidos. }
 *       401: { description: Não autenticado. }
 */
router.post('/', autenticarToken, requireBody(['tipo_jogo', 'valor_apostado']), criarAposta);

/**
 * @openapi
 * /api/apostas/minhas:
 *   get:
 *     tags: [Apostas]
 *     summary: Listar apostas do usuário autenticado
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Lista de apostas. }
 *       401: { description: Não autenticado. }
 */
router.get('/minhas', autenticarToken, listarMinhasApostas);

/**
 * @openapi
 * /api/apostas/{id}/resultado:
 *   patch:
 *     tags: [Apostas]
 *     summary: Atualizar resultado de uma aposta (ADMIN/MASTER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ganha, perde, cancelada]
 *               retorno_real:
 *                 type: number
 *                 example: 120
 *     responses:
 *       200: { description: Resultado atualizado. }
 *       400: { description: Status/retorno inválido. }
 *       401: { description: Não autenticado. }
 *       403: { description: Sem permissão. }
 *       404: { description: Aposta não encontrada. }
 */
router.patch(
  '/:id/resultado',
  autenticarToken,
  requireIntParam('id'),
  autorizarRoles('ADMIN', 'MASTER'),
  atualizarResultado
);

/**
 * @openapi
 * /api/apostas:
 *   get:
 *     tags: [Apostas]
 *     summary: Listar todas as apostas (ADMIN/MASTER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Lista de apostas com dados do usuário. }
 *       401: { description: Não autenticado. }
 *       403: { description: Sem permissão. }
 */
router.get('/', autenticarToken, autorizarRoles('ADMIN', 'MASTER'), listarTodasApostas);

export default router;

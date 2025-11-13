// src/routes/transacoes_externas.routes.js
import express from 'express';
import {
  criarTransacao,
  listarTransacoes,
  atualizarStatusTransacao,
} from '../controllers/transacaoExternaController.js';
import { autenticarToken, autorizarRoles } from '../middlewares/auth.middleware.js';

const router = express.Router();

/** helper p/ validar campos obrigatórios do body */
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

/** valida param inteiro em rotas com :id */
const requireIntParam = (paramName) => (req, res, next) => {
  const n = Number(req.params[paramName]);
  if (!Number.isInteger(n) || n <= 0) {
    return res.status(400).json({ erro: `Parâmetro inválido: ${paramName}` });
  }
  next();
};

/**
 * @openapi
 * /api/transacoes-externas:
 *   post:
 *     summary: Cria uma transação externa (depósito/saque via gateway)
 *     tags: [Transações Externas]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tipo, valor, metodo]
 *             properties:
 *               tipo:
 *                 type: string
 *                 enum: [deposito, saque]
 *                 example: deposito
 *               valor:
 *                 type: number
 *                 example: 150.50
 *               metodo:
 *                 type: string
 *                 example: pix
 *               observacao:
 *                 type: string
 *                 example: "Depósito via PIX"
 *     responses:
 *       201:
 *         description: Transação criada (status pendente)
 *       400:
 *         description: Erro de validação
 *       401:
 *         description: Não autenticado
 *       500:
 *         description: Erro interno
 */
router.post('/', autenticarToken, requireBody(['tipo', 'valor', 'metodo']), criarTransacao);

/**
 * @openapi
 * /api/transacoes-externas:
 *   get:
 *     summary: Lista todas as transações externas (ADMIN/OPERADOR)
 *     tags: [Transações Externas]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de transações
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Permissão insuficiente
 *       500:
 *         description: Erro interno
 */
router.get('/', autenticarToken, autorizarRoles('ADMIN', 'OPERADOR'), listarTransacoes);

/**
 * @openapi
 * /api/transacoes-externas/{id}:
 *   patch:
 *     summary: Atualiza o status da transação (aprovar/recusar) — ADMIN/OPERADOR
 *     tags: [Transações Externas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: ID da transação externa
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
 *                 enum: [aprovada, recusada]
 *                 example: aprovada
 *     responses:
 *       200:
 *         description: Status atualizado
 *       400:
 *         description: Body/estado inválido
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Permissão insuficiente
 *       404:
 *         description: Transação não encontrada
 *       500:
 *         description: Erro interno
 */
router.patch(
  '/:id',
  autenticarToken,
  autorizarRoles('ADMIN', 'OPERADOR'),
  requireIntParam('id'),
  requireBody(['status']),
  atualizarStatusTransacao
);

export default router;

// src/routes/saque.routes.js
import { Router } from 'express';
import { autenticarToken, autorizarRoles } from '../middlewares/auth.middleware.js';
import {
  criarSaque,
  listarMeusSaques,
  atualizarStatusSaque,
} from '../controllers/saqueController.js';

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

/** Valida param :id como inteiro positivo */
const validateIdParam = (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ erro: 'Parâmetro "id" inválido.' });
  }
  next();
};

/** Se status === 'recusado', motivo_recusa é obrigatório */
const requireReasonIfRejected = (req, res, next) => {
  const status = String(req.body?.status || '').toLowerCase();
  if (status === 'recusado') {
    const motivo = req.body?.motivo_recusa;
    if (!motivo || String(motivo).trim() === '') {
      return res.status(400).json({ erro: 'motivo_recusa é obrigatório quando status = recusado.' });
    }
  }
  next();
};

// Todas as rotas abaixo exigem JWT
router.use(autenticarToken);

/**
 * @openapi
 * /api/saques:
 *   post:
 *     summary: Solicita um saque (bloqueia o valor do saldo disponível)
 *     tags: [Saques]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [valor]
 *             properties:
 *               valor:
 *                 type: number
 *                 example: 150.00
 *               descricao:
 *                 type: string
 *                 example: "Saque via PIX"
 *     responses:
 *       201:
 *         description: Saque solicitado com sucesso (valor bloqueado)
 *       400:
 *         description: Erro de validação (limites, saldo, etc.)
 *       401:
 *         description: Não autenticado
 *       500:
 *         description: Erro interno ao solicitar saque
 */
router.post('/', requireBody(['valor']), criarSaque);

/**
 * @openapi
 * /api/saques/meus:
 *   get:
 *     summary: Lista os saques do usuário autenticado
 *     tags: [Saques]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de saques do usuário
 *       401:
 *         description: Não autenticado
 *       500:
 *         description: Erro ao listar saques
 */
router.get('/meus', listarMeusSaques);

/**
 * @openapi
 * /api/saques/{id}/status:
 *   patch:
 *     summary: Atualiza o status de um saque (ADMIN/MASTER/OPERADOR)
 *     tags: [Saques]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: ID do saque
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
 *                 enum: [recusado, aprovado, pago]
 *               motivo_recusa:
 *                 type: string
 *                 example: "Dados bancários inválidos"
 *                 description: Obrigatório quando status = recusado
 *     responses:
 *       200:
 *         description: Status atualizado
 *       400:
 *         description: Transição inválida / validação falhou
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Permissão insuficiente
 *       404:
 *         description: Saque não encontrado
 *       500:
 *         description: Erro ao atualizar status do saque
 */
router.patch(
  '/:id/status',
  autorizarRoles('ADMIN', 'MASTER', 'OPERADOR'),
  validateIdParam,
  requireBody(['status']),
  requireReasonIfRejected,
  atualizarStatusSaque
);

export default router;

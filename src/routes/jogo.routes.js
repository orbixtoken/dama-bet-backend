// src/routes/jogo.routes.js
import { Router } from 'express';
import { autenticarToken, autorizarRoles } from '../middlewares/auth.middleware.js';
import {
  criarJogo,
  listarJogos,
  atualizarStatusJogo,
} from '../controllers/jogoController.js';

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

/** Valida se um param é inteiro */
const requireIntParam = (paramName) => (req, res, next) => {
  const n = Number(req.params[paramName]);
  if (!Number.isInteger(n) || n <= 0) {
    return res.status(400).json({ erro: `Parâmetro inválido: ${paramName}` });
  }
  next();
};

/**
 * @openapi
 * /api/jogos:
 *   post:
 *     summary: Cria um novo jogo
 *     tags: [Jogos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nome, tipo]
 *             properties:
 *               nome: { type: string, example: "Mega Blaster" }
 *               tipo: { type: string, example: "loteria" }
 *               descricao: { type: string, example: "Jogo de múltiplas apostas" }
 *     responses:
 *       201: { description: Jogo criado }
 *       400: { description: Body inválido }
 *       401: { description: Não autenticado }
 *       403: { description: Sem permissão }
 */
router.post(
  '/',
  autenticarToken,
  autorizarRoles('ADMIN'),          // só admins criam jogos
  requireBody(['nome', 'tipo']),
  criarJogo
);

/**
 * @openapi
 * /api/jogos:
 *   get:
 *     summary: Lista jogos ativos
 *     tags: [Jogos]
 *     responses:
 *       200: { description: Lista de jogos }
 */
router.get('/', listarJogos);

/**
 * @openapi
 * /api/jogos/{id}/status:
 *   patch:
 *     summary: Atualiza status do jogo (ativo/inativo/encerrado)
 *     tags: [Jogos]
 *     security:
 *       - bearerAuth: []
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
 *                 oneOf:
 *                   - { type: boolean, example: true }
 *                   - { type: string, enum: ["ativo","inativo","encerrado"], example: "inativo" }
 *     responses:
 *       200: { description: Status atualizado }
 *       400: { description: Requisição inválida }
 *       401: { description: Não autenticado }
 *       403: { description: Sem permissão }
 *       404: { description: Jogo não encontrado }
 */
router.patch(
  '/:id/status',
  autenticarToken,
  autorizarRoles('ADMIN'),          // só admins alteram status
  requireIntParam('id'),
  requireBody(['status']),
  atualizarStatusJogo
);

export default router;

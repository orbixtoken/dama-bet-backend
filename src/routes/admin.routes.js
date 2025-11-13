// src/routes/admin.routes.js
import { Router } from 'express';
import { autenticarToken, autorizarRoles } from '../middlewares/auth.middleware.js';
import {
  listarUsuarios,
  bloquearUsuario,
  desbloquearUsuario,
  listarMovimentosPorUsuario,
  listarSaquesAdmin, // << ADICIONADO
} from '../controllers/admin.controller.js';

const router = Router();

/**
 * Middleware para validar params numéricos (inteiro > 0).
 * Uso: router.get('/usuarios/:id', requireIntParam('id'), handler)
 */
const requireIntParam = (paramName) => (req, res, next) => {
  const raw = req.params[paramName];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return res.status(400).json({ erro: `Parâmetro inválido: ${paramName}` });
  }
  next();
};

// 🔒 Todas as rotas abaixo exigem ADMIN ou MASTER
router.use(autenticarToken, autorizarRoles('ADMIN', 'MASTER'));

/**
 * @openapi
 * /api/admin/usuarios:
 *   get:
 *     tags: [Admin]
 *     summary: Lista usuários (ADMIN/MASTER)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de usuários.
 *       401:
 *         description: Não autenticado.
 *       403:
 *         description: Sem permissão.
 */
router.get('/usuarios', listarUsuarios);

/**
 * @openapi
 * /api/admin/usuarios/{id}/bloquear:
 *   patch:
 *     tags: [Admin]
 *     summary: Bloqueia um usuário (ADMIN/MASTER)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       200:
 *         description: Usuário bloqueado.
 *       400:
 *         description: Parâmetro inválido.
 *       401:
 *         description: Não autenticado.
 *       403:
 *         description: Sem permissão.
 *       404:
 *         description: Usuário não encontrado.
 */
router.patch('/usuarios/:id/bloquear', requireIntParam('id'), bloquearUsuario);

/**
 * @openapi
 * /api/admin/usuarios/{id}/desbloquear:
 *   patch:
 *     tags: [Admin]
 *     summary: Desbloqueia um usuário (ADMIN/MASTER)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       200:
 *         description: Usuário desbloqueado.
 *       400:
 *         description: Parâmetro inválido.
 *       401:
 *         description: Não autenticado.
 *       403:
 *         description: Sem permissão.
 *       404:
 *         description: Usuário não encontrado.
 */
router.patch('/usuarios/:id/desbloquear', requireIntParam('id'), desbloquearUsuario);

/**
 * @openapi
 * /api/admin/usuarios/{usuarioId}/movimentos:
 *   get:
 *     tags: [Admin]
 *     summary: Lista movimentos financeiros de um usuário (ADMIN/MASTER)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: usuarioId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       200:
 *         description: Lista de movimentos.
 *       400:
 *         description: Parâmetro inválido.
 *       401:
 *         description: Não autenticado.
 *       403:
 *         description: Sem permissão.
 *       404:
 *         description: Usuário não encontrado.
 */
router.get('/usuarios/:usuarioId/movimentos', requireIntParam('usuarioId'), listarMovimentosPorUsuario);

/**
 * @openapi
 * /api/admin/saques:
 *   get:
 *     tags: [Admin]
 *     summary: Lista saques com filtros (ADMIN/MASTER)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pendente, aprovado, recusado, pago] }
 *       - in: query
 *         name: usuario_id
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Lista paginada de saques.
 */
router.get('/saques', listarSaquesAdmin);

export default router;

// src/routes/dashboard.routes.js
import { Router } from 'express';
import { obterResumoDashboard } from '../controllers/dashboardController.js';
import { autenticarToken } from '../middlewares/auth.middleware.js';

const router = Router();

/**
 * @openapi
 * /api/dashboard/resumo:
 *   get:
 *     summary: Retorna o resumo geral do dashboard
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Resumo do dashboard
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 usuariosAtivos:
 *                   type: integer
 *                   example: 128
 *                 apostasHoje:
 *                   type: integer
 *                   example: 56
 *                 ganhosTotais:
 *                   type: number
 *                   format: float
 *                   example: 4250.00
 *                 apostasPendentes:
 *                   type: integer
 *                   example: 12
 *       401:
 *         description: Token ausente ou inválido
 */
router.get('/resumo', autenticarToken, obterResumoDashboard);

export default router;

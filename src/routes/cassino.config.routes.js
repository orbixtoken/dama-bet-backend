// src/routes/cassino.config.routes.js
import { Router } from 'express';
import { autenticarToken, autorizarRoles } from '../middlewares/auth.middleware.js';
import {
  listGamesConfig,
  getGameConfig,
  upsertGameConfig,
  patchGameConfig,
  deactivateGameConfig,
} from '../controllers/casinoGamesConfigController.js';

const router = Router();

// Segurança: exige ADMIN ou MASTER para todas as rotas deste módulo
router.use(autenticarToken, autorizarRoles('ADMIN', 'MASTER'));

/**
 * @openapi
 * /api/cassino/games-config:
 *   get:
 *     summary: Listar configurações de jogos de cassino
 *     tags: [Casino Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *       401: { description: Não autenticado }
 *       403: { description: Sem permissão }
 */
router.get('/games-config', listGamesConfig);

/**
 * @openapi
 * /api/cassino/games-config/{game_slug}:
 *   get:
 *     summary: Obter configuração de um jogo
 *     tags: [Casino Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: game_slug
 *         required: true
 *         schema: { type: string, example: "slots_common" }
 *     responses:
 *       200: { description: OK }
 *       404: { description: game_slug não encontrado }
 */
router.get('/games-config/:game_slug', getGameConfig);

/**
 * @openapi
 * /api/cassino/games-config/{game_slug}:
 *   put:
 *     summary: Criar/atualizar (upsert) configuração de jogo por slug
 *     tags: [Casino Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: game_slug
 *         required: true
 *         schema: { type: string, example: "slots_common" }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rtp_target, min_stake, max_stake]
 *             properties:
 *               ativo: { type: boolean, example: true }
 *               rtp_target: { type: number, example: 0.93, minimum: 0.8, maximum: 0.99 }
 *               min_stake: { type: number, example: 1 }
 *               max_stake: { type: number, example: 1000 }
 *               extra:
 *                 type: object
 *                 example:
 *                   paytable:
 *                     - { mult: 1.5, w: 100 }
 *                     - { mult: 3,   w: 25 }
 *                     - { mult: 10,  w: 3 }
 *     responses:
 *       200: { description: OK (criado ou atualizado) }
 *       400: { description: Validação }
 */
router.put('/games-config/:game_slug', upsertGameConfig);

/**
 * @openapi
 * /api/cassino/games-config/{game_slug}:
 *   patch:
 *     summary: Atualização parcial de config de jogo
 *     tags: [Casino Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: game_slug
 *         required: true
 *         schema: { type: string, example: "slots_premium" }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ativo: { type: boolean }
 *               rtp_target: { type: number, minimum: 0.8, maximum: 0.99 }
 *               min_stake: { type: number, minimum: 0 }
 *               max_stake: { type: number, minimum: 0 }
 *               extra:
 *                 type: object
 *                 example:
 *                   volatility: "high"
 *                   paytable:
 *                     - { mult: 2,  w: 60 }
 *                     - { mult: 5,  w: 8 }
 *                     - { mult: 20, w: 2 }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Validação }
 *       404: { description: game_slug não encontrado }
 */
router.patch('/games-config/:game_slug', patchGameConfig);

/**
 * @openapi
 * /api/cassino/games-config/{game_slug}:
 *   delete:
 *     summary: Inativar configuração de jogo (delete lógico)
 *     tags: [Casino Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: game_slug
 *         required: true
 *         schema: { type: string, example: "hilo" }
 *     responses:
 *       200: { description: OK (inativado) }
 *       404: { description: game_slug não encontrado }
 */
router.delete('/games-config/:game_slug', deactivateGameConfig);

export default router;

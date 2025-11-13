// src/routes/pfseeds.routes.js
import { Router } from 'express';
import { autenticarToken } from '../middlewares/auth.middleware.js';
import {
  getMySeed,
  rotateMySeed,
  setClientSeed,
} from '../controllers/pfSeedController.js';

const router = Router();

// todas exigem JWT
router.use(autenticarToken);

/**
 * GET /api/pf-seeds/:gameSlug/me
 * -> server_seed_hash, client_seed, nonce
 */
router.get('/:gameSlug/me', getMySeed);

/**
 * POST /api/pf-seeds/:gameSlug/rotate
 * -> revela seed antiga e cria nova
 */
router.post('/:gameSlug/rotate', rotateMySeed);

/**
 * PATCH /api/pf-seeds/:gameSlug/client
 * body: { client_seed }
 */
router.patch('/:gameSlug/client', setClientSeed);

export default router;

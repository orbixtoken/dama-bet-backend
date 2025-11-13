// src/routes/casino.routes.js
import { Router } from 'express';
import { autenticarToken } from '../middlewares/auth.middleware.js';
import {
  jogarCoinflip, listarMinhasCoinflip,
  jogarDice, listarMinhasDice,
  jogarHiLo, listarMinhasHiLo,
  jogarScratch, listarMinhasScratch,
  jogarSlotsCommon, jogarSlotsPremium,
  listarMinhasSlotsCommon, listarMinhasSlotsPremium,
} from '../controllers/casinoController.js';

const router = Router();

// todas as rotas do cassino exigem token
router.use(autenticarToken);

// Coinflip
router.post('/coinflip/play', jogarCoinflip);
router.get('/coinflip/minhas', listarMinhasCoinflip);

// Dice
router.post('/dice/play', jogarDice);
router.get('/dice/minhas', listarMinhasDice);

// Hi-Lo
router.post('/hilo/play', jogarHiLo);
router.get('/hilo/minhas', listarMinhasHiLo);

// Raspadinha
router.post('/scratch/play', jogarScratch);
router.get('/scratch/minhas', listarMinhasScratch);

// Slots
router.post('/slots/common/play', jogarSlotsCommon);
router.get('/slots/common/minhas', listarMinhasSlotsCommon);

router.post('/slots/premium/play', jogarSlotsPremium);
router.get('/slots/premium/minhas', listarMinhasSlotsPremium);

export default router;

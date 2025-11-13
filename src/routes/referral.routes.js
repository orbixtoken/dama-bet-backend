// src/routes/referral.routes.js   (use este nome OU ajuste o import no app.js)
import { Router } from 'express';
import { autenticarToken } from '../middlewares/auth.middleware.js';
import { myReferralInfo, claimWeeklyReward } from '../controllers/referralController.js';

const router = Router();

/**
 * Base mount: /api/referrals
 * Portanto:
 *  - GET  /api/referrals/me
 *  - GET  /api/referrals/history
 *  - POST /api/referrals/claim-weekly
 */

// Info do usuário (código de convite, pontos da semana, etc.)
router.get('/me', autenticarToken, myReferralInfo);

// Histórico (stub temporário; substitua quando tiver o handler real)
router.get('/history', autenticarToken, (req, res) => {
  res.json({ items: [], total: 0, page: 1, pageSize: 10 });
});

// Resgatar recompensa semanal
router.post('/claim-weekly', autenticarToken, claimWeeklyReward);

export default router;

// src/routes/psp.routes.js
import { Router } from 'express';
import { pspWebhook } from '../controllers/pspController.js';

const router = Router();

/**
 * @openapi
 * /api/webhooks/psp:
 *   post:
 *     summary: Webhook do PSP (idempotente)
 *     tags: [PSP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ext_id: { type: string, example: "tr_123" }
 *               user_id: { type: number, example: 42 }
 *               type: { type: string, example: "pix_in" }
 *               amount: { type: number, example: 100.0 }
 *               status: { type: string, example: "paid" }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Assinatura inválida ou payload ruim }
 */
router.post('/webhooks/psp', pspWebhook);

export default router;

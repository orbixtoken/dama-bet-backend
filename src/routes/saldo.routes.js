// src/routes/saldo.routes.js
import { Router } from 'express';
import { autenticarToken } from '../middlewares/auth.middleware.js';
import * as Saldo from '../controllers/saldoController.js';

const router = Router();

// escolhe o handler disponível no controller:
const getSaldoHandler =
  Saldo.obterSaldo || Saldo.getSaldo || Saldo.consultarSaldo;

if (!getSaldoHandler) {
  // fallback seguro para evitar crash caso nada esteja exportado
  console.warn('[saldo.routes] Nenhum handler de saldo encontrado no saldoController.js');
}

/**
 * @openapi
 * /api/saldo:
 *   get:
 *     summary: Retorna o saldo do usuário autenticado
 *     tags: [Financeiro]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Saldo atual do usuário
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 saldo_disponivel: { type: number, example: 150.0 }
 *                 saldo_bloqueado:  { type: number, example: 20.0 }
 *                 saldo_total:      { type: number, example: 170.0 }
 *       401:
 *         description: Não autenticado
 *       500:
 *         description: Erro interno
 */
router.get('/', autenticarToken, getSaldoHandler);

export default router;

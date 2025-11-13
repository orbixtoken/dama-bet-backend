// src/routes/resultado.routes.js
import { Router } from 'express';
import { autenticarToken, autorizarRoles } from '../middlewares/auth.middleware.js';
import { registrarResultado, listarResultados } from '../controllers/resultadoController.js';

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

/**
 * @openapi
 * /api/resultados:
 *   post:
 *     summary: Registrar resultado de um jogo
 *     tags: [Resultados]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [jogo_id, resultado]
 *             properties:
 *               jogo_id:
 *                 type: integer
 *                 example: 12
 *               resultado:
 *                 type: string
 *                 example: "Time A 2 x 1 Time B"
 *     responses:
 *       201: { description: Resultado registrado }
 *       400: { description: Body inválido }
 *       401: { description: Não autenticado }
 *       403: { description: Sem permissão }
 */
router.post(
  '/',
  autenticarToken,
  autorizarRoles('ADMIN', 'MASTER', 'OPERADOR'), // ajuste a lista de roles se preferir
  requireBody(['jogo_id', 'resultado']),
  registrarResultado
);

/**
 * @openapi
 * /api/resultados:
 *   get:
 *     summary: Listar resultados de jogos
 *     tags: [Resultados]
 *     responses:
 *       200:
 *         description: Lista de resultados
 */
router.get('/', listarResultados);

export default router;

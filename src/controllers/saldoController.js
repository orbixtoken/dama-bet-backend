// src/controllers/saldo.controller.js
import db from '../models/db.js';
import { verificarToken } from '../utils/tokenUtils.js';

/**
 * Preferimos req.usuario.id (setado por autenticarToken),
 * mas mantemos fallback para Authorization: Bearer <token>.
 */
function getUserId(req) {
  return (
    req.usuario?.id ||
    req.user?.id ||
    verificarToken(req.headers.authorization?.split(' ')[1])?.id
  );
}

/**
 * GET /api/saldo
 * Retorna saldo_disponivel, saldo_bloqueado e saldo_total.
 * Garante que a linha em "saldos" exista.
 */
export const obterSaldo = async (req, res) => {
  const usuarioId = getUserId(req);
  if (!usuarioId) {
    return res.status(401).json({ erro: 'Não autenticado.' });
  }

  try {
    // garante a existência do registro de saldo
    await db.query(
      `INSERT INTO saldos (usuario_id, saldo_disponivel, saldo_bloqueado)
       VALUES ($1, 0, 0)
       ON CONFLICT (usuario_id) DO NOTHING`,
      [usuarioId]
    );

    // busca os dois saldos
    const { rows } = await db.query(
      `SELECT saldo_disponivel, saldo_bloqueado
         FROM saldos
        WHERE usuario_id = $1`,
      [usuarioId]
    );

    const disp = Number(rows[0]?.saldo_disponivel || 0);
    const bloq = Number(rows[0]?.saldo_bloqueado || 0);

    return res.json({
      saldo_disponivel: disp,
      saldo_bloqueado: bloq,
      saldo_total: disp + bloq,
    });
  } catch (error) {
    console.error('Erro obterSaldo:', error);
    return res.status(500).json({ erro: 'Erro ao buscar saldo.' });
  }
};

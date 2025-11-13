// src/controllers/resultadoController.js
import db from '../models/db.js';

/**
 * POST /api/resultados
 * body: { jogo_id: number, resultado: string }
 * Registra o resultado de um jogo existente.
 */
export const registrarResultado = async (req, res) => {
  try {
    const { jogo_id, resultado } = req.body || {};

    const jogoId = Number(jogo_id);
    if (!Number.isInteger(jogoId)) {
      return res.status(400).json({ erro: 'jogo_id inválido.' });
    }

    const resultadoTxt = String(resultado ?? '').trim();
    if (!resultadoTxt) {
      return res.status(400).json({ erro: 'resultado é obrigatório.' });
    }

    // Garante que o jogo existe (evita FK quebrar com erro 500)
    const j = await db.query('SELECT id FROM jogos WHERE id = $1', [jogoId]);
    if (!j.rows.length) {
      return res.status(404).json({ erro: 'Jogo não encontrado.' });
    }

    const { rows } = await db.query(
      `INSERT INTO resultados_jogos (jogo_id, resultado)
       VALUES ($1, $2)
       RETURNING id, jogo_id, resultado, data_resultado`,
      [jogoId, resultadoTxt]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    // Tratativas amigáveis para erros comuns de banco
    if (err?.code === '23503') {
      // FK violation (jogo_id inválido)
      return res.status(409).json({ erro: 'Jogo relacionado inexistente.' });
    }
    if (err?.code === '23505') {
      // Caso você tenha adicionado alguma UNIQUE constraint futura
      return res.status(409).json({ erro: 'Resultado já registrado.' });
    }
    console.error('Erro ao registrar resultado:', err);
    return res.status(500).json({ erro: 'Erro ao registrar resultado.' });
  }
};

/**
 * GET /api/resultados
 * query (opcional):
 *   - jogo_id: filtra por jogo
 *   - de: YYYY-MM-DD (inclusive)
 *   - ate: YYYY-MM-DD (inclusive)
 *   - q: busca textual no campo resultado
 *   - limit: número (default 50)
 *   - offset: número (default 0)
 */
export const listarResultados = async (req, res) => {
  try {
    const {
      jogo_id,
      de,
      ate,
      q,
      limit = 50,
      offset = 0,
    } = req.query || {};

    const where = [];
    const params = [];
    let p = 1;

    if (jogo_id !== undefined) {
      const jogoId = Number(jogo_id);
      if (!Number.isInteger(jogoId)) {
        return res.status(400).json({ erro: 'jogo_id inválido.' });
      }
      where.push(`r.jogo_id = $${p++}`);
      params.push(jogoId);
    }

    if (de) {
      where.push(`r.data_resultado::date >= $${p++}`);
      params.push(de);
    }

    if (ate) {
      where.push(`r.data_resultado::date <= $${p++}`);
      params.push(ate);
    }

    if (q) {
      where.push(`unaccent(r.resultado) ILIKE unaccent($${p++})`);
      params.push(`%${q}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    params.push(Number(limit));
    params.push(Number(offset));

    const { rows } = await db.query(
      `
      SELECT r.id,
             r.jogo_id,
             j.nome      AS jogo,
             r.resultado,
             r.data_resultado
        FROM resultados_jogos r
        JOIN jogos j ON r.jogo_id = j.id
      ${whereSql}
      ORDER BY r.data_resultado DESC, r.id DESC
      LIMIT $${p++} OFFSET $${p++}
      `,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error('Erro ao listar resultados:', err);
    return res.status(500).json({ erro: 'Erro ao buscar resultados.' });
  }
};

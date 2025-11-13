// src/controllers/financeiroAdmin.controller.js
import db from "../models/db.js";

export async function listarMovimentosAdmin(req, res) {
  try {
    const {
      usuario_id,
      tipo,
      de,
      ate,
      page = 1,
      pageSize = 50,
    } = req.query || {};

    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(200, Math.max(1, Number(pageSize) || 50));

    const where = [];
    const params = [];
    let i = 1;

    if (usuario_id) {
      where.push(`m.usuario_id = $${i++}`);
      params.push(Number(usuario_id));
    }
    if (tipo) {
      where.push(`m.tipo = $${i++}`);
      params.push(String(tipo));
    }
    if (de) {
      where.push(`m.criado_em >= $${i++}::timestamptz`);
      params.push(new Date(de).toISOString());
    }
    if (ate) {
      where.push(`m.criado_em <= $${i++}::timestamptz`);
      params.push(new Date(ate).toISOString());
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { rows: tot } = await db.query(
      `SELECT COUNT(*)::int AS total FROM public.financeiro_movimentos m ${whereSql}`,
      params
    );
    const total = tot[0]?.total || 0;

    params.push(ps);
    params.push((p - 1) * ps);

    const { rows } = await db.query(
      `SELECT
          m.id,
          m.usuario_id,
          u.nome AS nome_usuario,
          u.usuario AS login,
          m.tipo,
          m.valor,
          m.descricao,
          m.saldo_antes,
          m.saldo_depois,
          m.criado_em AS created_at
       FROM public.financeiro_movimentos m
       JOIN public.usuarios u ON u.id = m.usuario_id
       ${whereSql}
       ORDER BY m.criado_em DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params
    );

    return res.json({ page: p, pageSize: ps, total, items: rows });
  } catch (err) {
    console.error("listarMovimentosAdmin erro:", err);
    return res.status(500).json({ erro: "Erro ao listar movimentos (admin)." });
  }
}

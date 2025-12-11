// controllers/adminClearMovimentosController.js
import db from '../models/db.js';

/**
 * POST /api/admin/financeiro/movimentos/clear
 * body: { q, tipo, from, to }
 */
export async function clearMovimentos(req, res) {
  try {
    const user = req.user || {};
    const removedBy = user.id ? String(user.id) : user.usuario || user.email || 'admin';

    const { q, tipo, from, to } = req.body ?? {};

    // construir WHERE
    const whereParts = ["removed = false"];
    const values = [];
    let idx = 1;

    if (q) {
      whereParts.push(`(lower(nome_usuario::text) LIKE lower($${idx}) OR lower(usuario::text) LIKE lower($${idx}) OR lower(login::text) LIKE lower($${idx}))`);
      values.push(`%${q}%`);
      idx++;
    }
    if (tipo) {
      whereParts.push(`lower(tipo::text) = lower($${idx})`);
      values.push(tipo);
      idx++;
    }
    if (from) {
      whereParts.push(`created_at >= $${idx}`);
      values.push(from);
      idx++;
    }
    if (to) {
      whereParts.push(`created_at <= $${idx}`);
      values.push(to);
      idx++;
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    // usar client do pool
    const client = await (db.connect ? db.connect() : Promise.resolve(db));
    let released = false;
    try {
      // Iniciar transação
      await client.query("BEGIN");

      // Seleciona ids (proteção FOR UPDATE)
      const selectSql = `SELECT id FROM financeiro_movimentos ${whereSql} FOR UPDATE`;
      const selectRes = await client.query(selectSql, values);
      const ids = selectRes.rows.map((r) => r.id);
      if (ids.length === 0) {
        await client.query("ROLLBACK");
        return res.json({ removedCount: 0 });
      }

      const now = new Date().toISOString();
      // Atualiza por array de ids — se id não for uuid, ajuste o cast
      const updateSql = `UPDATE financeiro_movimentos
        SET removed = true, removed_at = $${idx}, removed_by = $${idx + 1}
        WHERE id = ANY($${idx + 2}::text[])`;
      const updateVals = values.concat([now, removedBy, ids.map(String)]);

      await client.query(updateSql, updateVals);
      await client.query("COMMIT");

      // retornar contagem e ids (opcional)
      return res.json({ removedCount: ids.length, ids });
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw err;
    } finally {
      if (client.release) {
        client.release();
        released = true;
      }
    }
  } catch (err) {
    console.error('clearMovimentos error', err);
    res.status(500).json({ erro: 'Falha ao limpar movimentos.' });
  }
}

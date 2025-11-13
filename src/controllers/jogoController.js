// src/controllers/jogoController.js
import db from '../models/db.js';

/**
 * POST /api/jogos
 * body: { nome: string, tipo: string, descricao?: string }
 */
export const criarJogo = async (req, res) => {
  try {
    const { nome, tipo, descricao } = req.body || {};

    if (!nome || !tipo) {
      return res.status(400).json({ erro: 'Nome e tipo são obrigatórios.' });
    }

    const tipoNorm = String(tipo).trim().toLowerCase();

    const { rows } = await db.query(
      `INSERT INTO jogos (nome, tipo, descricao)
       VALUES ($1, $2, $3)
       RETURNING id, nome, tipo, descricao, status, criado_em`,
      [nome.trim(), tipoNorm, descricao?.trim() || null]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    // Se tiver unique constraint em (nome), devolve mensagem melhor
    if (err?.code === '23505') {
      return res.status(409).json({ erro: 'Já existe um jogo com esse nome.' });
    }
    console.error('Erro ao criar jogo:', err);
    return res.status(500).json({ erro: 'Erro ao criar jogo.' });
  }
};

/**
 * GET /api/jogos
 * query (opcional):
 *   - status=true|false
 *   - tipo=<string>
 *   - q=<busca em nome/descricao>
 *   - limit, offset
 *
 * Mantém compatibilidade: se nada for passado, retorna somente status=true (ativos).
 */
export const listarJogos = async (req, res) => {
  try {
    const {
      status,       // 'true' | 'false' | undefined
      tipo,         // filtro exato
      q,            // busca textual
      limit = 50,
      offset = 0,
    } = req.query || {};

    const where = [];
    const params = [];
    let p = 1;

    // comportamento antigo: se status não vier, filtra por ativos
    if (status === undefined) {
      where.push(`status = true`);
    } else {
      where.push(`status = $${p++}`);
      params.push(String(status).toLowerCase() === 'true');
    }

    if (tipo) {
      where.push(`tipo = $${p++}`);
      params.push(String(tipo).toLowerCase());
    }

    if (q) {
      where.push(`(unaccent(nome) ILIKE unaccent($${p}) OR unaccent(coalesce(descricao,'')) ILIKE unaccent($${p}))`);
      params.push(`%${q}%`);
      p++;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(Number(limit));
    params.push(Number(offset));

    const { rows } = await db.query(
      `
      SELECT id, nome, tipo, descricao, status, criado_em
        FROM jogos
      ${whereSql}
       ORDER BY criado_em DESC
       LIMIT $${p++} OFFSET $${p++}
      `,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar jogos:', err);
    return res.status(500).json({ erro: 'Erro ao buscar jogos.' });
  }
};

/**
 * PATCH /api/jogos/:id/status
 * body: { status: boolean }
 */
export const atualizarStatusJogo = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    const jogoId = Number(id);
    if (!Number.isInteger(jogoId)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    if (typeof status !== 'boolean') {
      return res.status(400).json({ erro: 'status deve ser booleano.' });
    }

    const { rowCount } = await db.query(
      `UPDATE jogos
          SET status = $1
        WHERE id = $2`,
      [status, jogoId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ erro: 'Jogo não encontrado.' });
    }

    return res.json({ sucesso: `Status atualizado para ${status ? 'ativo' : 'inativo'}.` });
  } catch (err) {
    console.error('Erro ao atualizar status do jogo:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar status.' });
  }
};

/* ====== OPCIONAL: endpoints extras, se desejar no futuro ====== */

// Atualizar dados do jogo (nome/tipo/descricao)
export const atualizarJogo = async (req, res) => {
  try {
    const { id } = req.params;
    const jogoId = Number(id);
    if (!Number.isInteger(jogoId)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const { nome, tipo, descricao } = req.body || {};
    if (!nome && !tipo && descricao === undefined) {
      return res.status(400).json({ erro: 'Envie ao menos um campo para atualizar.' });
    }

    const tipoNorm = tipo ? String(tipo).trim().toLowerCase() : undefined;

    const { rows } = await db.query(
      `
      UPDATE jogos
         SET nome      = COALESCE($1, nome),
             tipo      = COALESCE($2, tipo),
             descricao = COALESCE($3, descricao)
       WHERE id = $4
       RETURNING id, nome, tipo, descricao, status, criado_em
      `,
      [nome?.trim() || null, tipoNorm || null, (descricao ?? null), jogoId]
    );

    if (!rows.length) {
      return res.status(404).json({ erro: 'Jogo não encontrado.' });
    }

    return res.json(rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ erro: 'Já existe um jogo com esse nome.' });
    }
    console.error('Erro ao atualizar jogo:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar jogo.' });
  }
};

// “Excluir” jogo (soft delete: status=false)
export const desativarJogo = async (req, res) => {
  try {
    const { id } = req.params;
    const jogoId = Number(id);
    if (!Number.isInteger(jogoId)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const { rowCount } = await db.query(
      `UPDATE jogos SET status = false WHERE id = $1`,
      [jogoId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ erro: 'Jogo não encontrado.' });
    }

    return res.json({ sucesso: 'Jogo desativado.' });
  } catch (err) {
    console.error('Erro ao desativar jogo:', err);
    return res.status(500).json({ erro: 'Erro ao desativar jogo.' });
  }
};

// src/controllers/transacaoExternaController.js
import db from '../models/db.js';

/** Utils */
const TIPOS_VALIDOS = ['deposito', 'saque'];
const STATUS_VALIDOS = ['pendente', 'aprovada', 'recusada'];

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * POST /api/transacoes-externas
 * Body: { tipo: 'deposito'|'saque', valor: number, metodo: string, observacao?: string }
 * Cria uma transação externa pendente (não altera saldo ainda).
 */
export const criarTransacao = async (req, res) => {
  try {
    const usuario_id = req.usuario?.id;
    const { tipo, valor, metodo, observacao } = req.body || {};

    if (!usuario_id) return res.status(401).json({ erro: 'Não autenticado.' });

    if (!tipo || !TIPOS_VALIDOS.includes(String(tipo).toLowerCase())) {
      return res.status(400).json({ erro: `tipo inválido. Use: ${TIPOS_VALIDOS.join(', ')}.` });
    }
    const v = toNumber(valor);
    if (!v || v <= 0) return res.status(400).json({ erro: 'valor deve ser numérico > 0.' });
    if (!metodo) return res.status(400).json({ erro: 'metodo é obrigatório.' });

    const { rows } = await db.query(
      `INSERT INTO transacoes_externas (usuario_id, tipo, valor, metodo, status, observacao)
       VALUES ($1, $2, $3, $4, 'pendente', $5)
       RETURNING *`,
      [usuario_id, String(tipo).toLowerCase(), v, metodo, observacao || null]
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Erro ao criar transação externa:', error);
    return res.status(500).json({ erro: 'Erro ao criar transação.' });
  }
};

/**
 * GET /api/transacoes-externas
 * Query (opcional): ?status=&tipo=&usuario_id=&limit=&offset=
 * Lista transações, com filtros simples.
 */
export const listarTransacoes = async (req, res) => {
  try {
    const { status, tipo, usuario_id, limit = 50, offset = 0 } = req.query || {};

    const where = [];
    const params = [];
    let p = 1;

    if (status && STATUS_VALIDOS.includes(String(status).toLowerCase())) {
      where.push(`te.status = $${p++}`);
      params.push(String(status).toLowerCase());
    }
    if (tipo && TIPOS_VALIDOS.includes(String(tipo).toLowerCase())) {
      where.push(`te.tipo = $${p++}`);
      params.push(String(tipo).toLowerCase());
    }
    if (usuario_id) {
      where.push(`te.usuario_id = $${p++}`);
      params.push(Number(usuario_id));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(Number(limit));
    params.push(Number(offset));

    const { rows } = await db.query(
      `
      SELECT te.*, u.usuario
        FROM transacoes_externas te
        JOIN usuarios u ON te.usuario_id = u.id
      ${whereSql}
       ORDER BY te.data_transacao DESC
       LIMIT $${p++} OFFSET $${p++}
      `,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error('Erro ao listar transações:', error);
    return res.status(500).json({ erro: 'Erro ao buscar transações.' });
  }
};

/**
 * PATCH /api/transacoes-externas/:id
 * Body: { status: 'aprovada'|'recusada', observacao?: string }
 * Aprova/recusa transação:
 *  - aprovando depósito: credita saldo_disponivel
 *  - aprovando saque   : debita saldo_disponivel (checa saldo)
 *  - recusando         : apenas marca recusada (sem mexer em saldo)
 */
export const atualizarStatusTransacao = async (req, res) => {
  const { id } = req.params;
  const { status, observacao } = req.body || {};

  const novoStatus = String(status || '').toLowerCase();
  if (!['aprovada', 'recusada'].includes(novoStatus)) {
    return res.status(400).json({ erro: 'Status inválido. Use: aprovada ou recusada.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Carrega a transação e trava registro
    const { rows: txRows } = await client.query(
      `SELECT id, usuario_id, tipo, valor, status
         FROM transacoes_externas
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    const tx = txRows[0];
    if (!tx) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Transação não encontrada.' });
    }

    if (tx.status !== 'pendente') {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Somente transações pendentes podem ser alteradas.' });
    }

    // Sempre atualiza o status + observacao
    await client.query(
      `UPDATE transacoes_externas
          SET status = $1,
              observacao = COALESCE($2, observacao),
              data_transacao = data_transacao -- mantém a criação
        WHERE id = $3`,
      [novoStatus, observacao || null, tx.id]
    );

    // Se recusada → sem efeitos de saldo
    if (novoStatus === 'recusada') {
      await client.query('COMMIT');
      return res.json({ mensagem: 'Transação recusada.' });
    }

    // A partir daqui: aprovada → mexe no saldo
    // Garante linha em saldos
    await client.query(
      `INSERT INTO saldos (usuario_id, saldo_disponivel, saldo_bloqueado)
       VALUES ($1, 0, 0)
       ON CONFLICT (usuario_id) DO NOTHING`,
      [tx.usuario_id]
    );

    // Trava saldo do usuário
    const { rows: sRows } = await client.query(
      `SELECT saldo_disponivel, saldo_bloqueado
         FROM saldos
        WHERE usuario_id = $1
        FOR UPDATE`,
      [tx.usuario_id]
    );
    if (!sRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Saldo do usuário não encontrado.' });
    }

    const dispAntes = Number(sRows[0].saldo_disponivel || 0);
    const bloqAntes = Number(sRows[0].saldo_bloqueado || 0);
    const valor = Number(tx.valor);

    if (tx.tipo === 'deposito') {
      const dispDepois = dispAntes + valor;

      await client.query(
        `UPDATE saldos
            SET saldo_disponivel = $1
          WHERE usuario_id = $2`,
        [dispDepois, tx.usuario_id]
      );

      await client.query(
        `INSERT INTO financeiro_movimentos
           (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois)
         VALUES ($1, 'deposito_externo', $2, $3, $4, $5)`,
        [tx.usuario_id, valor, `Depósito externo #${tx.id} aprovado`, dispAntes, dispDepois]
      );

      await client.query('COMMIT');
      return res.json({
        mensagem: 'Transação aprovada e saldo creditado.',
        saldo: { saldo_disponivel: dispDepois, saldo_bloqueado: bloqAntes },
      });
    }

    if (tx.tipo === 'saque') {
      if (dispAntes < valor) {
        await client.query('ROLLBACK');
        return res.status(400).json({ erro: 'Saldo disponível insuficiente para saque externo.' });
      }

      const dispDepois = dispAntes - valor;

      await client.query(
        `UPDATE saldos
            SET saldo_disponivel = $1
          WHERE usuario_id = $2`,
        [dispDepois, tx.usuario_id]
      );

      await client.query(
        `INSERT INTO financeiro_movimentos
           (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois)
         VALUES ($1, 'saque_externo', $2, $3, $4, $5)`,
        [tx.usuario_id, valor, `Saque externo #${tx.id} aprovado`, dispAntes, dispDepois]
      );

      await client.query('COMMIT');
      return res.json({
        mensagem: 'Transação aprovada e saldo debitado.',
        saldo: { saldo_disponivel: dispDepois, saldo_bloqueado: bloqAntes },
      });
    }

    // fallback (tipo inesperado)
    await client.query('ROLLBACK');
    return res.status(400).json({ erro: 'Tipo de transação não suportado.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao atualizar transação externa:', error);
    return res.status(500).json({ erro: 'Erro ao atualizar transação.' });
  } finally {
    try { (await client).release?.(); } catch {}
  }
};

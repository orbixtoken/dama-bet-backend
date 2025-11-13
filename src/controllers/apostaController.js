// src/controllers/apostaController.js
import db from '../models/db.js';

/**
 * Regras:
 * - Criar aposta: move do saldo_disponivel -> saldo_bloqueado (trava a stake).
 * - Resultado:
 *   - 'ganha'     : libera a stake do bloqueado e credita retorno_real no disponível.
 *   - 'perde'     : consome a stake do bloqueado (disponível não muda).
 *   - 'cancelada' : estorna a stake do bloqueado -> disponível.
 */

// Garante linha na tabela de saldos (idempotente)
async function ensureSaldoRow(client, usuarioId) {
  await client.query(
    `INSERT INTO saldos (usuario_id, saldo_disponivel, saldo_bloqueado)
     VALUES ($1, 0, 0)
     ON CONFLICT (usuario_id) DO NOTHING`,
    [usuarioId]
  );
}

/* =========================
 * 🎰 Criar nova aposta
 * ========================= */
export const criarAposta = async (req, res) => {
  const usuarioId = req.usuario?.id;
  const { tipo_jogo, valor_apostado, retorno_esperado } = req.body;

  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });
  if (!tipo_jogo) return res.status(400).json({ erro: 'tipo_jogo é obrigatório.' });

  const valor = Number(valor_apostado);
  if (!Number.isFinite(valor) || valor <= 0) {
    return res.status(400).json({ erro: 'Valor da aposta inválido.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // garante saldo
    await ensureSaldoRow(client, usuarioId);

    // trava saldo do usuário
    const { rows: sal } = await client.query(
      `SELECT saldo_disponivel, saldo_bloqueado
         FROM saldos
        WHERE usuario_id = $1
        FOR UPDATE`,
      [usuarioId]
    );
    if (!sal.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Saldo do usuário não encontrado.' });
    }

    const disp = Number(sal[0].saldo_disponivel || 0);
    const bloq = Number(sal[0].saldo_bloqueado || 0);

    if (disp < valor) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Saldo disponível insuficiente.' });
    }

    // cria aposta (pendente)
    const { rows: ap } = await client.query(
      `INSERT INTO apostas (usuario_id, tipo_jogo, valor_apostado, retorno_esperado, status)
       VALUES ($1, $2, $3, $4, 'pendente')
       RETURNING id, usuario_id, tipo_jogo, valor_apostado, retorno_esperado, retorno_real, status, criado_em`,
      [usuarioId, tipo_jogo, valor, retorno_esperado ?? null]
    );

    // move disponível -> bloqueado
    const saldoAntes = disp;
    const novoDisp = disp - valor;
    const novoBloq = bloq + valor;

    await client.query(
      `UPDATE saldos
          SET saldo_disponivel = $1,
              saldo_bloqueado  = $2
        WHERE usuario_id = $3`,
      [novoDisp, novoBloq, usuarioId]
    );

    // auditoria
    await client.query(
      `INSERT INTO financeiro_movimentos
         (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois)
       VALUES ($1, 'aposta', $2, $3, $4, $5)`,
      [usuarioId, valor, `Aposta criada em ${tipo_jogo}`, saldoAntes, novoDisp]
    );

    await client.query('COMMIT');
    return res.status(201).json({
      mensagem: 'Aposta criada com sucesso (valor bloqueado).',
      aposta: ap[0],
      saldo: { saldo_disponivel: novoDisp, saldo_bloqueado: novoBloq },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro criarAposta:', err);
    return res.status(500).json({ erro: 'Erro ao criar aposta.' });
  } finally {
    client.release();
  }
};

/* ===============================
 * 📜 Listar apostas do usuário
 * =============================== */
export const listarMinhasApostas = async (req, res) => {
  try {
    const usuarioId = req.usuario?.id;
    if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });

    const { rows } = await db.query(
      `SELECT id, tipo_jogo, valor_apostado, retorno_esperado, retorno_real, status, criado_em
         FROM apostas
        WHERE usuario_id = $1
        ORDER BY criado_em DESC`,
      [usuarioId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Erro listarMinhasApostas:', err);
    return res.status(500).json({ erro: 'Erro ao listar apostas.' });
  }
};

/* ==========================================
 * 🛠️ Atualizar resultado da aposta (ADMIN)
 * ========================================== */
export const atualizarResultado = async (req, res) => {
  const { id } = req.params;
  const { status, retorno_real } = req.body;

  if (!['ganha', 'perde', 'cancelada'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }

  const retorno = Number(retorno_real ?? 0);
  if (status === 'ganha' && (!Number.isFinite(retorno) || retorno <= 0)) {
    return res.status(400).json({ erro: 'Para status "ganha", retorno_real deve ser > 0.' });
  }
  if (status !== 'ganha' && Number.isFinite(retorno) && retorno > 0) {
    return res.status(400).json({ erro: 'Retorno só pode ser positivo quando status é "ganha".' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // trava aposta
    const { rows: apRows } = await client.query(
      `SELECT id, usuario_id, valor_apostado, status
         FROM apostas
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    const aposta = apRows[0];
    if (!aposta) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Aposta não encontrada.' });
    }
    if (aposta.status !== 'pendente') {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Aposta já foi finalizada.' });
    }

    // trava saldo
    const { rows: sal } = await client.query(
      `SELECT saldo_disponivel, saldo_bloqueado
         FROM saldos
        WHERE usuario_id = $1
        FOR UPDATE`,
      [aposta.usuario_id]
    );
    if (!sal.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Saldo do usuário não encontrado.' });
    }

    const disp = Number(sal[0].saldo_disponivel || 0);
    const bloq = Number(sal[0].saldo_bloqueado || 0);
    const stake = Number(aposta.valor_apostado);

    if (status === 'ganha') {
      // libera stake do bloqueado e credita retorno no disponível
      if (bloq < stake) {
        await client.query('ROLLBACK');
        return res.status(409).json({ erro: 'Saldo bloqueado insuficiente para liberar aposta.' });
      }
      const novoBloq = bloq - stake;
      const saldoAntes = disp;
      const novoDisp = disp + retorno;

      await client.query(
        `UPDATE saldos
            SET saldo_disponivel = $1,
                saldo_bloqueado  = $2
          WHERE usuario_id = $3`,
        [novoDisp, novoBloq, aposta.usuario_id]
      );

      await client.query(
        `INSERT INTO financeiro_movimentos
           (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois)
         VALUES ($1, 'credito', $2, $3, $4, $5)`,
        [aposta.usuario_id, retorno, `Aposta #${aposta.id} (ganha)`, saldoAntes, novoDisp]
      );
    }

    if (status === 'perde') {
      // consome stake do bloqueado
      if (bloq < stake) {
        await client.query('ROLLBACK');
        return res.status(409).json({ erro: 'Saldo bloqueado insuficiente para baixar aposta.' });
      }
      const novoBloq = bloq - stake;

      await client.query(
        `UPDATE saldos
            SET saldo_bloqueado = $1
          WHERE usuario_id = $2`,
        [novoBloq, aposta.usuario_id]
      );

      await client.query(
        `INSERT INTO financeiro_movimentos
           (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois)
         VALUES ($1, 'baixa_aposta', $2, $3, $4, $5)`,
        [aposta.usuario_id, stake, `Aposta #${aposta.id} (perdeu)`, disp, disp]
      );
    }

    if (status === 'cancelada') {
      // estorna stake: bloqueado -> disponível
      if (bloq < stake) {
        await client.query('ROLLBACK');
        return res.status(409).json({ erro: 'Saldo bloqueado insuficiente para estorno.' });
      }
      const novoBloq = bloq - stake;
      const saldoAntes = disp;
      const novoDisp = disp + stake;

      await client.query(
        `UPDATE saldos
            SET saldo_disponivel = $1,
                saldo_bloqueado  = $2
          WHERE usuario_id = $3`,
        [novoDisp, novoBloq, aposta.usuario_id]
      );

      await client.query(
        `INSERT INTO financeiro_movimentos
           (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois)
         VALUES ($1, 'estorno_aposta', $2, $3, $4, $5)`,
        [aposta.usuario_id, stake, `Aposta #${aposta.id} (cancelada)`, saldoAntes, novoDisp]
      );
    }

    // atualiza aposta
    await client.query(
      `UPDATE apostas
          SET status = $1,
              retorno_real = $2
        WHERE id = $3`,
      [status, status === 'ganha' ? retorno : 0, aposta.id]
    );

    await client.query('COMMIT');
    return res.json({ sucesso: `Aposta #${aposta.id} atualizada para ${status}.` });
  } catch (err) {
    console.error('Erro atualizarResultado:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar resultado da aposta.' });
  } finally {
    // se ainda estiver em transação e caiu em exceção anterior, COMMIT/ROLLBACK já feitos nos blocos
    // apenas garantimos release
    // (release não é async)
    try { (await 0), null; } catch {}
  }
};

/* =================================
 * 📊 Listar todas as apostas (ADMIN)
 * ================================= */
export const listarTodasApostas = async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT a.*, u.nome AS nome_usuario, u.usuario AS login
         FROM apostas a
         JOIN usuarios u ON a.usuario_id = u.id
        ORDER BY a.criado_em DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('Erro listarTodasApostas:', err);
    return res.status(500).json({ erro: 'Erro ao buscar apostas.' });
  }
};

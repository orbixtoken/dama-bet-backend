// src/controllers/saqueController.js
import db from '../models/db.js';

/* =============================== Utils =============================== */
async function getSaquesConfig(client) {
  const { rows } = await client.query(
    `SELECT valor_minimo, valor_maximo, limite_diario
       FROM public.saques_config
   ORDER BY id
      LIMIT 1`
  );
  if (!rows.length) throw new Error('Configuração de saques ausente.');
  return rows[0];
}

async function getSomaDiaria(client, usuarioId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(valor),0) AS total
       FROM public.saques
      WHERE usuario_id = $1
        AND created_at::date = CURRENT_DATE
        AND status IN ('pendente','aprovado','pago')`,
    [usuarioId]
  );
  return Number(rows[0].total || 0);
}

// Garante a linha em saldos (idempotente)
async function ensureSaldoRow(client, usuarioId) {
  await client.query(
    `INSERT INTO public.saldos (usuario_id, saldo_disponivel, saldo_bloqueado)
     VALUES ($1, 0, 0)
     ON CONFLICT (usuario_id) DO NOTHING`,
    [usuarioId]
  );
}

// Validação completa de chave PIX
function isPixValida(raw) {
  if (!raw) return false;
  const v = String(raw).trim();

  // e-mail
  const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
  if (reEmail.test(v)) return true;

  // telefone BR
  const rePhone = /^(?:\+?55)?\s*(?:\(?\d{2}\)?)?\s*\d{4,5}[-\s.]?\d{4}$/;
  if (rePhone.test(v)) return true;

  // CPF/CNPJ (apenas formato/quantidade de dígitos)
  const digits = v.replace(/\D/g, '');
  if (digits.length === 11 || digits.length === 14) return true;

  // chave aleatória UUID
  const reUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (reUUID.test(v)) return true;

  // fallback (mín. 3 máx. 140)
  if (v.length >= 3 && v.length <= 140) return true;

  return false;
}

/* ============================== Handlers ============================= */

/**
 * POST /api/saques
 * Usuário solicita saque: move do disponível para o bloqueado e cria o saque "pendente".
 */
export async function solicitarSaque(req, res) {
  const usuarioId = req.usuario?.id;
  const valor = Number(req.body?.valor || 0);
  const pix_chave = String(req.body?.pix_chave || '').trim();

  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });
  if (!Number.isFinite(valor) || valor <= 0) {
    return res.status(400).json({ erro: 'Valor inválido.' });
  }
  if (!isPixValida(pix_chave)) {
    return res.status(400).json({ erro: 'Chave PIX inválida.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cfg = await getSaquesConfig(client);
    if (valor < Number(cfg.valor_minimo) || valor > Number(cfg.valor_maximo)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        erro: `Valor fora dos limites. Mín.: ${cfg.valor_minimo} | Máx.: ${cfg.valor_maximo}.`,
      });
    }

    const somaHoje = await getSomaDiaria(client, usuarioId);
    if (somaHoje + valor > Number(cfg.limite_diario)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        erro: `Limite diário excedido. Já utilizado hoje: ${somaHoje}. Limite: ${cfg.limite_diario}.`,
      });
    }

    await ensureSaldoRow(client, usuarioId);
    const { rows: rsSaldo } = await client.query(
      `SELECT usuario_id, saldo_disponivel, saldo_bloqueado
         FROM public.saldos
        WHERE usuario_id = $1
        FOR UPDATE`,
      [usuarioId]
    );
    const saldo = rsSaldo[0];
    if (!saldo) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Saldo não encontrado.' });
    }
    if (Number(saldo.saldo_disponivel) < valor) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Saldo disponível insuficiente.' });
    }

    const novoDisp = Number(saldo.saldo_disponivel) - valor;
    const novoBloq = Number(saldo.saldo_bloqueado) + valor;

    await client.query(
      `UPDATE public.saldos
          SET saldo_disponivel = $1,
              saldo_bloqueado  = $2
        WHERE usuario_id = $3`,
      [novoDisp, novoBloq, usuarioId]
    );

    const { rows: rsSaque } = await client.query(
      `INSERT INTO public.saques (usuario_id, valor, status, pix_chave, created_at, updated_at)
       VALUES ($1, $2, 'pendente', $3, NOW(), NOW())
       RETURNING id, usuario_id, valor, status, pix_chave, created_at, updated_at`,
      [usuarioId, valor, pix_chave.slice(0, 140)]
    );

    await client.query(
      `INSERT INTO public.financeiro_movimentos
         (usuario_id, tipo, valor, saldo_antes, saldo_depois, criado_em, descricao)
       VALUES ($1, 'saque', $2, $3, $4, NOW(), 'Bloqueio de valor para saque')`,
      [usuarioId, valor, saldo.saldo_disponivel, novoDisp]
    );

    await client.query('COMMIT');
    return res.status(201).json({
      mensagem: 'Saque solicitado com sucesso (valor bloqueado).',
      saque: rsSaque[0],
      saldo: { saldo_disponivel: novoDisp, saldo_bloqueado: novoBloq },
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    if (err.code === '23505' && String(err.constraint || '').includes('uq_saques_pendente_por_usuario')) {
      return res.status(409).json({
        erro: 'Você já possui um saque pendente. Aprove/recuse antes de solicitar outro.',
      });
    }
    console.error('Erro solicitarSaque:', err);
    return res.status(500).json({ erro: 'Erro ao solicitar saque.' });
  } finally {
    client.release();
  }
}

/* ============================== Listagens ============================= */

/**
 * GET /api/saques/meus
 */
export async function listarMeusSaques(req, res) {
  const usuarioId = req.usuario?.id;
  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });

  try {
    const { rows } = await db.query(
      `SELECT id, valor, status, pix_chave, created_at, updated_at
         FROM public.saques
        WHERE usuario_id = $1
        ORDER BY created_at DESC`,
      [usuarioId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Erro listarMeusSaques:', err);
    return res.status(500).json({ erro: 'Erro ao listar saques.' });
  }
}

/**
 * GET /api/saques/todos
 * Suporta filtros e paginação. Retorna { page, pageSize, total, items }.
 * Query: status, usuario_id, from, to, page, pageSize
 */
export async function listarTodosSaques(req, res) {
  try {
    const {
      status,
      usuario_id,
      from,
      to,
      page = 1,
      pageSize = 20,
    } = req.query || {};

    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));

    const where = [];
    const params = [];
    let i = 1;

    if (status)      { where.push(`s.status = $${i++}`);      params.push(String(status)); }
    if (usuario_id)  { where.push(`s.usuario_id = $${i++}`);  params.push(Number(usuario_id)); }
    if (from)        { where.push(`s.created_at >= $${i++}`); params.push(new Date(from)); }
    if (to)          { where.push(`s.created_at <= $${i++}`); params.push(new Date(to)); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // total
    const { rows: rTot } = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM public.saques s
         ${whereSql}`,
      params
    );
    const total = rTot[0]?.total || 0;

    // paginação
    params.push(ps);                 // $i
    params.push((p - 1) * ps);       // $i+1
    const { rows } = await db.query(
      `SELECT
          s.id,
          s.usuario_id,
          s.valor,
          s.status,
          s.pix_chave,            -- <<< ESSENCIAL PARA O PAINEL
          s.motivo_recusa,
          s.created_at,
          s.updated_at,
          u.nome    AS nome_usuario,
          u.usuario AS login,
          u.email
        FROM public.saques s
        JOIN public.usuarios u ON u.id = s.usuario_id
        ${whereSql}
        ORDER BY s.created_at DESC
        LIMIT $${i++} OFFSET $${i++}`,
      params
    );

    return res.json({
      page: p,
      pageSize: ps,
      total,
      items: rows,
    });
  } catch (err) {
    console.error('Erro listarTodosSaques:', err);
    return res.status(500).json({ erro: 'Erro ao listar saques.' });
  }
}

/* ====================== PATCH /api/saques/:id/status ====================== */
export async function atualizarStatusSaque(req, res) {
  const saqueId = Number(req.params.id);
  const { status, motivo } = req.body || {};

  if (!Number.isInteger(saqueId)) {
    return res.status(400).json({ erro: 'ID inválido.' });
  }
  const statusNovo = String(status || '').toLowerCase().trim();
  if (!['recusado', 'aprovado', 'pago'].includes(statusNovo)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: rsSaque } = await client.query(
      `SELECT id, usuario_id, valor, status
         FROM public.saques
        WHERE id = $1
        FOR UPDATE`,
      [saqueId]
    );
    if (!rsSaque.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Saque não encontrado.' });
    }
    const saque = rsSaque[0];

    if (saque.status === statusNovo) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Saque já está com esse status.' });
    }

    const atual = saque.status;
    const permitido =
      (atual === 'pendente' && (statusNovo === 'recusado' || statusNovo === 'aprovado')) ||
      (atual === 'aprovado' && statusNovo === 'pago');

    if (!permitido) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Transição de status não permitida.' });
    }

    let saldoAtual;
    if (statusNovo !== 'aprovado') {
      const { rows: rsSaldo } = await client.query(
        `SELECT usuario_id, saldo_disponivel, saldo_bloqueado
           FROM public.saldos
          WHERE usuario_id = $1
          FOR UPDATE`,
        [saque.usuario_id]
      );
      if (!rsSaldo.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ erro: 'Saldo do usuário não encontrado.' });
      }
      saldoAtual = rsSaldo[0];
    }

    if (atual === 'pendente' && statusNovo === 'recusado') {
      const novoDisp = Number(saldoAtual.saldo_disponivel) + Number(saque.valor);
      const novoBloq = Number(saldoAtual.saldo_bloqueado) - Number(saque.valor);
      await client.query(
        `UPDATE public.saldos
            SET saldo_disponivel = $1,
                saldo_bloqueado  = $2
          WHERE usuario_id = $3`,
        [novoDisp, novoBloq, saque.usuario_id]
      );
      await client.query(
        `UPDATE public.saques
            SET status = 'recusado',
                motivo_recusa = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [saque.id, (motivo || '').toString().slice(0, 500)]
      );
      await client.query(
        `INSERT INTO public.financeiro_movimentos
           (usuario_id, tipo, valor, saldo_antes, saldo_depois, criado_em, descricao)
         VALUES ($1, 'credito', $2, $3, $4, NOW(), 'Estorno de saque recusado')`,
        [saque.usuario_id, saque.valor, saldoAtual.saldo_disponivel, novoDisp]
      );
      await client.query('COMMIT');
      return res.json({
        sucesso: 'Status atualizado para recusado.',
        saldo: { saldo_disponivel: novoDisp, saldo_bloqueado: novoBloq },
      });
    }

    if (atual === 'pendente' && statusNovo === 'aprovado') {
      await client.query(
        `UPDATE public.saques
            SET status = 'aprovado', updated_at = NOW()
          WHERE id = $1`,
        [saque.id]
      );
      await client.query(
        `INSERT INTO public.financeiro_movimentos
           (usuario_id, tipo, valor, criado_em, descricao)
         VALUES ($1, 'aprovacao_saque', $2, NOW(), 'Saque aprovado; valor segue bloqueado')`,
        [saque.usuario_id, saque.valor]
      );
      await client.query('COMMIT');
      return res.json({ sucesso: 'Status atualizado para aprovado.' });
    }

    if (atual === 'aprovado' && statusNovo === 'pago') {
      const novoBloq = Number(saldoAtual.saldo_bloqueado) - Number(saque.valor);
      await client.query(
        `UPDATE public.saldos
            SET saldo_bloqueado = $1
          WHERE usuario_id = $2`,
        [novoBloq, saque.usuario_id]
      );
      await client.query(
        `UPDATE public.saques
            SET status = 'pago', updated_at = NOW()
          WHERE id = $1`,
        [saque.id]
      );
      await client.query(
        `INSERT INTO public.financeiro_movimentos
           (usuario_id, tipo, valor, saldo_antes, saldo_depois, criado_em, descricao)
         VALUES ($1, 'pagamento_saque', $2, $3, $4, NOW(), 'Saque pago (débito do bloqueado)')`,
        [saque.usuario_id, saque.valor, saldoAtual.saldo_disponivel, saldoAtual.saldo_disponivel]
      );
      await client.query('COMMIT');
      return res.json({
        sucesso: 'Status atualizado para pago.',
        saldo: { saldo_disponivel: saldoAtual.saldo_disponivel, saldo_bloqueado: novoBloq },
      });
    }

    await client.query('ROLLBACK');
    return res.status(400).json({ erro: 'Transição de status não tratada.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Erro atualizarStatusSaque:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar status do saque.' });
  } finally {
    client.release();
  }
}

/* --------- Compatibilidade de nome --------- */
export { solicitarSaque as criarSaque };

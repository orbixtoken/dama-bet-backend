// src/controllers/depositos.controller.js
import db from '../models/db.js';

/* ------------ helpers ------------- */
function gerarRef(n = 7) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I
  let s = 'RF';
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

async function getPixChaveCasa() {
  // 1) .env – aceita PIX_CHAVE_CASA ou PIX_CHAVE
  const envCandidates = [
    process.env.PIX_CHAVE_CASA,
    process.env.PIX_CHAVE,
  ];

  for (const v of envCandidates) {
    if (v && String(v).trim()) {
      return String(v).trim();
    }
  }

  // 2) tabela config_kv (opcional) – aceita PIX_CHAVE_CASA ou PIX_CHAVE, case-insensitive
  try {
    const { rows } = await db.query(
      `
      SELECT valor
        FROM public.config_kv
       WHERE LOWER(chave) IN ('pix_chave_casa', 'pix_chave')
       ORDER BY chave
       LIMIT 1
      `,
    );
    if (rows?.length && rows[0].valor) {
      return String(rows[0].valor).trim();
    }
  } catch (e) {
    // se a tabela não existir ou coluna não existir, só ignore
    if (!['42P01', '42703'].includes(e?.code)) throw e;
  }

  return null;
}

async function ensureSaldoRow(client, usuarioId) {
  await client.query(
    `INSERT INTO public.saldos (usuario_id, saldo_disponivel, saldo_bloqueado)
     VALUES ($1, 0, 0)
     ON CONFLICT (usuario_id) DO NOTHING`,
    [usuarioId]
  );
}

/* ============== SITE ============== */
/**
 * POST /api/depositos
 * Body: { valor:number }
 * Cria depósito PENDENTE e retorna ticket: { codigo_ref, pix_chave, deposito }
 */
export async function criarDeposito(req, res) {
  const usuarioId = req.usuario?.id;
  const valor = Number(req.body?.valor);

  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });
  if (!Number.isFinite(valor) || valor <= 0) {
    return res.status(400).json({ erro: 'Valor inválido.' });
  }

  const pix_chave = await getPixChaveCasa();
  if (!pix_chave) {
    return res.status(500).json({ erro: 'Chave PIX da casa não configurada.' });
  }

  const codigo_ref = gerarRef();

  try {
    const { rows } = await db.query(
      `INSERT INTO public.depositos
         (usuario_id, valor, metodo, status, codigo_ref, pix_chave, created_at, updated_at)
       VALUES ($1, $2, 'PIX', 'pendente', $3, $4, NOW(), NOW())
       RETURNING id, usuario_id, valor, metodo, status, codigo_ref, pix_chave, created_at, updated_at`,
      [usuarioId, valor, codigo_ref, pix_chave]
    );

    return res.status(201).json({
      mensagem: 'Depósito criado. Faça o PIX e informe o código no campo mensagem.',
      pix_chave,
      codigo_ref,
      deposito: rows[0],
    });
  } catch (err) {
    console.error('criarDeposito erro:', err);
    return res.status(500).json({ erro: 'Erro ao criar depósito.' });
  }
}

/**
 * GET /api/depositos/meus
 * Lista os depósitos do usuário autenticado
 */
export async function listarMeusDepositos(req, res) {
  const usuarioId = req.usuario?.id;
  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });

  try {
    const { rows } = await db.query(
      `SELECT id, valor, metodo, status, codigo_ref, pix_chave, motivo_recusa, created_at, updated_at
         FROM public.depositos
        WHERE usuario_id = $1
        ORDER BY created_at DESC`,
      [usuarioId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('listarMeusDepositos erro:', err);
    return res.status(500).json({ erro: 'Erro ao listar depósitos.' });
  }
}

/* ============== ADMIN ============== */
/**
 * GET /api/admin/depositos
 * Query: status, usuario_id, ref, from, to, page, pageSize
 * Retorna { page, pageSize, total, items }
 */
export async function listarDepositosAdmin(req, res) {
  try {
    const {
      status,
      usuario_id,
      ref,
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

    if (status)      { where.push(`d.status = $${i++}`);                   params.push(String(status)); }
    if (usuario_id)  { where.push(`d.usuario_id = $${i++}`);               params.push(Number(usuario_id)); }
    if (ref)         { where.push(`d.codigo_ref ILIKE $${i++}`);           params.push(`%${String(ref)}%`); }
    if (from)        { where.push(`d.created_at >= $${i++}::timestamptz`); params.push(new Date(from).toISOString()); }
    if (to)          { where.push(`d.created_at <= $${i++}::timestamptz`); params.push(new Date(to).toISOString()); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: tot } = await db.query(
      `SELECT COUNT(*)::int AS total FROM public.depositos d ${whereSql}`,
      params
    );
    const total = tot[0]?.total || 0;

    params.push(ps);
    params.push((p - 1) * ps);

    const { rows } = await db.query(
      `SELECT
          d.id,
          d.usuario_id,
          d.valor,
          d.status,
          d.codigo_ref,
          d.metodo,
          d.motivo_recusa,
          d.created_at,
          d.updated_at,
          u.nome    AS nome_usuario,   -- existe na tabela usuarios
          u.usuario AS login           -- existe na tabela usuarios
       FROM public.depositos d
       JOIN public.usuarios u ON u.id = d.usuario_id
       ${whereSql}
       ORDER BY d.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params
    );

    return res.json({ page: p, pageSize: ps, total, items: rows });
  } catch (err) {
    console.error('listarDepositosAdmin erro:', err);
    return res.status(500).json({ erro: 'Erro ao listar depósitos.' });
  }
}

/**
 * PATCH /api/admin/depositos/:id/status
 * Body: { status: 'aprovado'|'recusado', motivo? }
 * - aprovado: credita saldo_disponivel e registra movimento 'deposito'
 * - recusado: apenas atualiza status/motivo
 */
export async function atualizarStatusDeposito(req, res) {
  const id = Number(req.params.id);
  const novo = String(req.body?.status || '').toLowerCase().trim();
  const motivo = (req.body?.motivo || '').toString().slice(0, 500);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ erro: 'ID inválido.' });
  }
  if (!['aprovado', 'recusado'].includes(novo)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: rDep } = await client.query(
      `SELECT id, usuario_id, valor, status
         FROM public.depositos
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    if (!rDep.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Depósito não encontrado.' });
    }
    const dep = rDep[0];

    if (dep.status === novo) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Depósito já está com esse status.' });
    }
    if (dep.status !== 'pendente') {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Apenas depósitos pendentes podem ser alterados.' });
    }

    if (novo === 'recusado') {
      await client.query(
        `UPDATE public.depositos
            SET status = 'recusado', motivo_recusa = $2, updated_at = NOW()
          WHERE id = $1`,
        [dep.id, motivo || null]
      );
      await client.query('COMMIT');
      return res.json({ sucesso: 'Depósito marcado como recusado.' });
    }

    // -------- aprovado -> credita --------
    await ensureSaldoRow(client, dep.usuario_id);

    const { rows: rSaldo } = await client.query(
      `SELECT usuario_id, saldo_disponivel
         FROM public.saldos
        WHERE usuario_id = $1
        FOR UPDATE`,
      [dep.usuario_id]
    );
    if (!rSaldo.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Saldo do usuário não encontrado.' });
    }
    const saldo = rSaldo[0];
    const saldoAntes = Number(saldo.saldo_disponivel);
    const saldoDepois = saldoAntes + Number(dep.valor);

    await client.query(
      `UPDATE public.saldos
          SET saldo_disponivel = $1
        WHERE usuario_id = $2`,
      [saldoDepois, dep.usuario_id]
    );

    await client.query(
      `INSERT INTO public.financeiro_movimentos
         (usuario_id, tipo, valor, saldo_antes, saldo_depois, criado_em, descricao)
       VALUES ($1, 'deposito', $2, $3, $4, NOW(), 'Crédito por depósito PIX aprovado')`,
      [dep.usuario_id, dep.valor, saldoAntes, saldoDepois]
    );

    await client.query(
      `UPDATE public.depositos
          SET status = 'aprovado', updated_at = NOW()
        WHERE id = $1`,
      [dep.id]
    );

    await client.query('COMMIT');
    return res.json({
      sucesso: 'Depósito aprovado e creditado.',
      saldo: { saldo_disponivel: saldoDepois },
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('atualizarStatusDeposito erro:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar depósito.' });
  } finally {
    client.release();
  }
}

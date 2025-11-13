// src/controllers/financeiroController.js
import db, { query, withTransaction } from '../models/db.js';
import { verificarToken } from '../utils/tokenUtils.js';
import { z } from 'zod';

/* =========================
 * Helpers
 * ========================= */
function getUserId(req) {
  const id = req.usuario?.id || req.user?.id;
  if (id) return id;

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (!token) return undefined;

  try {
    const decoded = verificarToken(token);
    return decoded?.id;
  } catch {
    return undefined;
  }
}

async function ensureSaldo(usuarioId, clientOrDb = db) {
  // Aceita client de transação ou pool default
  await clientOrDb.query(
    `INSERT INTO public.saldos (usuario_id, saldo_disponivel, saldo_bloqueado)
     VALUES ($1, 0, 0)
     ON CONFLICT (usuario_id) DO NOTHING`,
    [usuarioId]
  );
}

/* =========================
 * Schemas
 * ========================= */
const depositoSchema = z.object({
  valor: z.number().positive().max(100000),
  descricao: z.string().max(120).optional(),
});

const saqueSchema = z.object({
  valor: z.number().positive().max(100000),
  descricao: z.string().max(120).optional(),
});

/** Indique & Ganhe */
const REF_MIN_FIRST_DEPOSIT = Number(process.env.REF_MIN_FIRST_DEPOSIT || 50);
const REF_FIRST_DEPOSIT_POINTS = 500;
const WEEK_START_SQL = `date_trunc('week', (now() AT TIME ZONE 'UTC'))::date`;

/* =========================
 * 📥 DEPÓSITO
 * ========================= */
export const depositar = async (req, res) => {
  const usuarioId = getUserId(req);
  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });

  const parsed = depositoSchema.safeParse({
    valor: Number(req.body?.valor),
    descricao: req.body?.descricao,
  });
  if (!parsed.success) {
    return res.status(400).json({
      erro: 'Payload inválido',
      detalhes: parsed.error.flatten(),
    });
  }
  const { valor, descricao } = parsed.data;

  try {
    let saldoDepois = 0;

    await withTransaction(async (client) => {
      await ensureSaldo(usuarioId, client);

      // trava linha
      const { rows } = await client.query(
        `SELECT saldo_disponivel
           FROM public.saldos
          WHERE usuario_id = $1
          FOR UPDATE`,
        [usuarioId]
      );
      const saldoAntes = Number(rows[0]?.saldo_disponivel ?? 0);
      saldoDepois = saldoAntes + Number(valor);

      await client.query(
        `UPDATE public.saldos
            SET saldo_disponivel = $1
          WHERE usuario_id = $2`,
        [saldoDepois, usuarioId]
      );

      await client.query(
        `INSERT INTO public.financeiro_movimentos
           (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois, criado_em)
         VALUES ($1, 'deposito', $2, $3, $4, $5, NOW())`,
        [usuarioId, valor, descricao || 'Depósito', saldoAntes, saldoDepois]
      );

      // Indique & Ganhe (best-effort)
      if (Number(valor) >= REF_MIN_FIRST_DEPOSIT) {
        try {
          const refRow = await client.query(
            `SELECT referred_by_user_id FROM public.usuarios WHERE id = $1`,
            [usuarioId]
          );
          const referrerId = refRow.rows[0]?.referred_by_user_id;

          if (referrerId && referrerId !== usuarioId) {
            const cnt = await client.query(
              `SELECT COUNT(*)::int AS c
                 FROM public.financeiro_movimentos
                WHERE usuario_id = $1 AND tipo = 'deposito'`,
              [usuarioId]
            );
            const countDepositos = Number(cnt.rows[0]?.c || 0);

            if (countDepositos === 1) {
              const wk = await client.query(`SELECT ${WEEK_START_SQL} AS w`);
              const weekStart = wk.rows[0].w;

              await client.query(
                `INSERT INTO public.referral_events
                   (referrer_user_id, referred_user_id, type, amount, points, week_start, created_at)
                 VALUES ($1, $2, 'first_deposit', $3, $4, $5, NOW())`,
                [referrerId, usuarioId, valor, REF_FIRST_DEPOSIT_POINTS, weekStart]
              );
            }
          }
        } catch (refErr) {
          console.error('Indique&Ganhe (first_deposit) falhou:', refErr);
        }
      }
    });

    return res.status(200).json({
      mensagem: 'Depósito realizado com sucesso.',
      saldo_disponivel: saldoDepois,
    });
  } catch (err) {
    console.error('Erro depositar:', err);
    return res.status(500).json({ erro: 'Não foi possível depositar.' });
  }
};

/* =========================
 * 💸 SAQUE DIRETO
 * ========================= */
export const sacar = async (req, res) => {
  const usuarioId = getUserId(req);
  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });

  const parsed = saqueSchema.safeParse({
    valor: Number(req.body?.valor),
    descricao: req.body?.descricao,
  });
  if (!parsed.success) {
    return res.status(400).json({
      erro: 'Payload inválido',
      detalhes: parsed.error.flatten(),
    });
  }
  const { valor, descricao } = parsed.data;

  try {
    let saldoDepois = 0;

    await withTransaction(async (client) => {
      await ensureSaldo(usuarioId, client);

      const { rows } = await client.query(
        `SELECT saldo_disponivel
           FROM public.saldos
          WHERE usuario_id = $1
          FOR UPDATE`,
        [usuarioId]
      );

      const saldoAntes = Number(rows[0]?.saldo_disponivel ?? 0);
      if (saldoAntes < valor) {
        throw new Error('SALDO_INSUFICIENTE');
      }

      saldoDepois = saldoAntes - valor;

      await client.query(
        `UPDATE public.saldos
            SET saldo_disponivel = $1
          WHERE usuario_id = $2`,
        [saldoDepois, usuarioId]
      );

      await client.query(
        `INSERT INTO public.financeiro_movimentos
           (usuario_id, tipo, valor, descricao, criado_em, saldo_antes, saldo_depois)
         VALUES ($1, 'saque', $2, $3, NOW(), $4, $5)`,
        [usuarioId, valor, descricao || 'Saque', saldoAntes, saldoDepois]
      );
    });

    return res.json({
      mensagem: 'Saque realizado com sucesso.',
      saldo_disponivel: saldoDepois,
    });
  } catch (err) {
    if (err?.message === 'SALDO_INSUFICIENTE') {
      return res.status(400).json({ erro: 'Saldo insuficiente.' });
    }
    console.error('Erro sacar:', err);
    return res.status(500).json({ erro: 'Erro ao realizar saque.' });
  }
};

/* =========================
 * 👁️ CONSULTAR SALDO
 * ========================= */
export const consultarSaldo = async (req, res) => {
  const usuarioId = getUserId(req);
  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });

  try {
    await ensureSaldo(usuarioId, db);

    const { rows } = await query(
      `SELECT saldo_disponivel, saldo_bloqueado
         FROM public.saldos
        WHERE usuario_id = $1
        LIMIT 1`,
      [usuarioId]
    );

    const disp = Number(rows[0]?.saldo_disponivel ?? 0);
    const bloq = Number(rows[0]?.saldo_bloqueado ?? 0);

    return res.json({
      saldo_disponivel: disp,
      saldo_bloqueado: bloq,
      saldo_total: disp + bloq,
    });
  } catch (err) {
    console.error('Erro consultarSaldo:', err);
    return res.status(500).json({ erro: 'Erro ao consultar saldo.' });
  }
};

/* =========================
 * 📋 LISTAR MOVIMENTOS (usuário)
 * ========================= */
export const listarMovimentos = async (req, res) => {
  const usuarioId = getUserId(req);
  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });

  const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize ?? '20', 10)));
  const offset = (page - 1) * pageSize;

  try {
    await ensureSaldo(usuarioId, db);

    const { rows } = await db.query(
      `SELECT 
          id,
          usuario_id,
          tipo,
          valor,
          descricao,
          criado_em AS created_at,
          saldo_antes,
          saldo_depois
       FROM public.financeiro_movimentos
       WHERE usuario_id = $1
       ORDER BY criado_em DESC
       LIMIT $2 OFFSET $3`,
      [usuarioId, pageSize, offset]
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total
         FROM public.financeiro_movimentos
        WHERE usuario_id = $1`,
      [usuarioId]
    );

    return res.json({ items: rows, total: Number(countRows[0]?.total || 0), page, pageSize });
  } catch (err) {
    console.error('Erro listarMovimentos:', err);
    return res.status(500).json({ erro: 'Erro ao listar movimentos.' });
  }
};

/* =========================
 * 📊 RESUMO (saldo + últimos movimentos)
 * (útil para a página Financeiro do site)
 * ========================= */
export const getResumo = async (req, res) => {
  const usuarioId = getUserId(req);
  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });

  try {
    await ensureSaldo(usuarioId, db);

    const saldoQ = await query(
      `SELECT saldo_disponivel, saldo_bloqueado
         FROM public.saldos
        WHERE usuario_id = $1
        LIMIT 1`,
      [usuarioId]
    );
    const saldo = saldoQ.rows[0] || { saldo_disponivel: 0, saldo_bloqueado: 0 };

    const movQ = await query(
      `SELECT id, tipo, valor, descricao, criado_em AS created_at, saldo_antes, saldo_depois
         FROM public.financeiro_movimentos
        WHERE usuario_id = $1
        ORDER BY criado_em DESC
        LIMIT 50`,
      [usuarioId]
    );

    return res.json({
      saldo_disponivel: Number(saldo.saldo_disponivel || 0),
      saldo_bloqueado: Number(saldo.saldo_bloqueado || 0),
      movimentos: movQ.rows || [],
    });
  } catch (err) {
    console.error('Erro getResumo:', err);
    return res.status(500).json({ erro: 'Erro ao carregar resumo.' });
  }
};

/* =========================
 * 📋 LISTAR MOVIMENTOS — ADMIN (geral)
 * ========================= */
export const listarMovimentosGeralAdmin = async (req, res) => {
  // Valida perfil
  try {
    let role = String(
      req.usuario?.funcao_user_role ||
      req.usuario?.funcao ||
      req.usuario?.role ||
      ''
    ).toUpperCase();

    if (!role) {
      const uid = req.usuario?.id || req.user?.id;
      if (!uid) return res.status(401).json({ erro: 'Não autenticado.' });

      const { rows } = await query(
        `SELECT COALESCE(NULLIF(TRIM(funcao::text), ''), NULLIF(TRIM(role::text), '')) AS role
           FROM public.usuarios
          WHERE id = $1
          LIMIT 1`,
        [uid]
      );
      role = String(rows[0]?.role || '').toUpperCase();
    }

    if (!['ADMIN', 'MASTER'].includes(role)) {
      return res.status(403).json({ erro: 'Acesso negado.' });
    }
  } catch (e) {
    console.error('Falha ao validar role admin:', e);
    return res.status(500).json({ erro: 'Falha ao validar permissão.' });
  }

  const {
    page = 1,
    pageSize = 20,
    usuario_id,
    tipo,
    q,
    from,
    to,
  } = req.query || {};

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const offset = (p - 1) * ps;

  const where = [];
  const params = [];
  let i = 1;

  if (usuario_id) { where.push(`m.usuario_id = $${i++}`); params.push(Number(usuario_id)); }
  if (tipo)       { where.push(`m.tipo = $${i++}`);       params.push(String(tipo)); }
  if (from)       { where.push(`m.criado_em >= $${i++}::timestamptz`); params.push(new Date(from).toISOString()); }
  if (to)         { where.push(`m.criado_em <= $${i++}::timestamptz`);   params.push(new Date(to).toISOString()); }
  if (q) {
    where.push(`(
      m.descricao ILIKE $${i} OR
      u.nome      ILIKE $${i} OR
      u.usuario   ILIKE $${i}
    )`);
    params.push(`%${String(q)}%`);
    i++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const { rows: tot } = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM public.financeiro_movimentos m
         LEFT JOIN public.usuarios u ON u.id = m.usuario_id
       ${whereSql}`,
      params
    );
    const total = tot[0]?.total || 0;

    params.push(ps, offset);

    const { rows } = await db.query(
      `SELECT
          m.id,
          m.usuario_id,
          u.nome     AS nome_usuario,
          u.usuario  AS login,
          m.tipo,
          m.valor,
          m.descricao,
          m.saldo_antes,
          m.saldo_depois,
          m.criado_em AS created_at
       FROM public.financeiro_movimentos m
       LEFT JOIN public.usuarios u ON u.id = m.usuario_id
       ${whereSql}
       ORDER BY m.criado_em DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params
    );

    return res.json({ items: rows, total, page: p, pageSize: ps });
  } catch (err) {
    console.error('listarMovimentosGeralAdmin erro:', err);
    return res.status(500).json({ erro: 'Erro ao listar movimentos (admin).' });
  }
};

export default {
  depositar,
  sacar,
  consultarSaldo,
  listarMovimentos,
  getResumo,
  listarMovimentosGeralAdmin,
};

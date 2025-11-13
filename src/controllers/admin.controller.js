// src/controllers/admin.controller.js
import db from '../models/db.js';
import { AppError } from '../middlewares/error.middleware.js';

// Tipos permitidos pela CHECK de financeiro_movimentos
const TIPOS_MOV_VALIDOS = new Set([
  'deposito',
  'saque',
  'aposta',
  'credito',
  'estorno_aposta',
  'baixa_aposta',
  'aprovacao_saque',
  'pagamento_saque',
  'deposito_externo',
  'saque_externo',
]);

// Status válidos para saques (tabela public.saques)
const STATUS_SAQUE_VALIDOS = new Set(['pendente', 'aprovado', 'recusado', 'pago']);

/** Auditoria best-effort:
 *  - usa apenas colunas existentes (usuario_id, acao, detalhes)
 *  - ignora 42P01 (tabela não existe) e 42703 (coluna não existe)
 */
async function safeAudit({ usuarioId, acao, detalhes }) {
  try {
    await db.query(
      `INSERT INTO public.auditoria (usuario_id, acao, detalhes)
       VALUES ($1, $2, $3)`,
      [usuarioId ?? null, acao, detalhes ?? null]
    );
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      console.warn('WARN auditoria ignorada:', {
        code: err.code,
        message: err.message,
        detail: err.detail,
        column: err.column,
      });
      return;
    }
    throw err;
  }
}

/* =========================================
 *  LISTAR USUÁRIOS (paginaçao + busca livre)
 * ========================================= */
export const listarUsuarios = async (req, res, next) => {
  try {
    const page  = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const q     = (req.query.q ?? '').toString().trim();
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (LOWER(usuario) LIKE LOWER($${params.length})
                    OR LOWER(nome)    LIKE LOWER($${params.length}))`;
    }

    const countSql = `SELECT COUNT(*) FROM public.usuarios ${where}`;
    const dataSql  = `
      SELECT id, nome, usuario, funcao, ativo, criado_em
        FROM public.usuarios
       ${where}
       ORDER BY criado_em DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const [{ rows: countRows }, { rows }] = await Promise.all([
      db.query(countSql, params),
      db.query(dataSql, [...params, limit, offset]),
    ]);

    res.json({
      page,
      limit,
      total: Number(countRows[0].count),
      data: rows,
    });
  } catch (err) {
    next(err);
  }
};

/* ===========================
 *  BLOQUEAR USUÁRIO (ativo=F)
 * =========================== */
export const bloquearUsuario = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const motivo = (req.body?.motivo ?? '').toString().slice(0, 500);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('ID inválido.', 400);
    }

    const { rowCount } = await db.query(
      `UPDATE public.usuarios SET ativo = FALSE WHERE id = $1`,
      [id]
    );
    if (!rowCount) throw new AppError('Usuário não encontrado.', 404);

    // opcional: revogar refresh tokens do usuário bloqueado
    await db.query(
      `UPDATE public.refresh_tokens
          SET revoked = TRUE
        WHERE user_id = $1 AND revoked = FALSE`,
      [id]
    );

    // auditoria (best-effort)
    await safeAudit({
      usuarioId: id,
      acao: 'bloquear_usuario',
      detalhes: motivo || null,
    });

    res.json({ mensagem: 'Usuário bloqueado.' });
  } catch (err) {
    next(err);
  }
};

/* =============================
 *  DESBLOQUEAR USUÁRIO (ativo=T)
 * ============================= */
export const desbloquearUsuario = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('ID inválido.', 400);
    }

    const { rowCount } = await db.query(
      `UPDATE public.usuarios SET ativo = TRUE WHERE id = $1`,
      [id]
    );
    if (!rowCount) throw new AppError('Usuário não encontrado.', 404);

    await safeAudit({
      usuarioId: id,
      acao: 'desbloquear_usuario',
      detalhes: null,
    });

    res.json({ mensagem: 'Usuário desbloqueado.' });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
 *  LISTAR MOVIMENTOS por usuário (com filtros e paginação)
 * ============================================================ */
export const listarMovimentosPorUsuario = async (req, res, next) => {
  try {
    const usuarioId = Number(req.params.usuarioId);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      throw new AppError('Parâmetro usuarioId inválido.', 400);
    }

    const page  = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const offset = (page - 1) * limit;

    const params = [usuarioId];
    let where = 'WHERE usuario_id = $1';

    // filtro de tipo respeitando CHECK
    const tipo = (req.query.tipo ?? '').toString().trim();
    if (tipo) {
      if (!TIPOS_MOV_VALIDOS.has(tipo)) {
        throw new AppError('Tipo de movimento inválido.', 400);
      }
      params.push(tipo);
      where += ` AND tipo = $${params.length}`;
    }

    // datas (ISO) — usamos timestamptz
    const de  = req.query.de  ? new Date(req.query.de)  : null;
    const ate = req.query.ate ? new Date(req.query.ate) : null;

    if (de && !isNaN(de)) {
      params.push(de.toISOString());
      where += ` AND criado_em >= $${params.length}::timestamptz`;
    }
    if (ate && !isNaN(ate)) {
      params.push(ate.toISOString());
      where += ` AND criado_em <= $${params.length}::timestamptz`;
    }

    const countSql = `SELECT COUNT(*) FROM public.financeiro_movimentos ${where}`;
    const dataSql  = `
      SELECT id, tipo, valor, descricao, saldo_antes, saldo_depois, criado_em
        FROM public.financeiro_movimentos
       ${where}
       ORDER BY criado_em DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const [{ rows: countRows }, { rows }] = await Promise.all([
      db.query(countSql, params),
      db.query(dataSql, [...params, limit, offset]),
    ]);

    res.json({
      page,
      limit,
      total: Number(countRows[0].count),
      data: rows,
    });
  } catch (err) {
    next(err);
  }
};

/* ===========================================
 *  LISTAR SAQUES (admin) com filtros/paginação
 *  GET /api/admin/saques?status=&usuario_id=&from=&to=&page=&pageSize=
 * =========================================== */
export const listarSaquesAdmin = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
    const offset = (page - 1) * pageSize;

    const conds = [];
    const params = [];

    // status
    const status = (req.query.status ?? '').toString().trim().toLowerCase();
    if (status) {
      if (!STATUS_SAQUE_VALIDOS.has(status)) {
        throw new AppError('Status inválido. Use pendente|aprovado|recusado|pago.', 400);
      }
      params.push(status);
      conds.push(`s.status = $${params.length}`);
    }

    // usuario_id
    const usuarioId = Number(req.query.usuario_id ?? 0);
    if (usuarioId) {
      if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
        throw new AppError('usuario_id inválido.', 400);
      }
      params.push(usuarioId);
      conds.push(`s.usuario_id = $${params.length}`);
    }

    // datas (from/to)
    const from = req.query.from ? new Date(req.query.from) : null;
    const to   = req.query.to   ? new Date(req.query.to)   : null;

    if (from && !isNaN(from)) {
      params.push(from.toISOString());
      conds.push(`s.created_at >= $${params.length}::timestamptz`);
    }
    if (to && !isNaN(to)) {
      params.push(to.toISOString());
      conds.push(`s.created_at <= $${params.length}::timestamptz`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) FROM public.saques s ${where}`;
    const dataSql = `
      SELECT
  s.id,
  s.usuario_id,
  u.nome      AS nome_usuario,
  u.usuario   AS login,
  s.valor,
  s.status,
  s.pix_chave,              -- mantém a chave PIX
  s.motivo_recusa,
  s.created_at,
  s.updated_at
FROM public.saques s
LEFT JOIN public.usuarios u ON u.id = s.usuario_id
-- ... where/ordenacao/paginacao iguais

      ${where}
      ORDER BY s.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const [{ rows: cRows }, { rows }] = await Promise.all([
      db.query(countSql, params),
      db.query(dataSql, [...params, pageSize, offset]),
    ]);

    res.json({
      page,
      pageSize,
      total: Number(cRows[0]?.count || 0),
      items: rows,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  listarUsuarios,
  bloquearUsuario,
  desbloquearUsuario,
  listarMovimentosPorUsuario,
  listarSaquesAdmin,
};

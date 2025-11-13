// src/routes/financeiro.routes.js
import { Router } from "express";
import { autenticarToken } from "../middlewares/auth.middleware.js";
import {
  depositar,
  sacar,
  consultarSaldo,
  listarMovimentos,
  listarMovimentosGeralAdmin,
  getResumo, // ✅ novo resumo (saldo + últimos movimentos)
} from "../controllers/financeiroController.js";
import { query } from "../models/db.js";

const router = Router();

/** Normaliza número > 0 (aceita vírgula e ignora símbolos). */
const requireNumeric = (field) => (req, res, next) => {
  const raw = req.body?.[field];
  const cleaned =
    typeof raw === "string"
      ? raw.replace(/\s/g, "").replace(/[R$\u00A0]/g, "").replace(",", ".")
      : raw;
  const v = Number(cleaned);
  if (!Number.isFinite(v) || v <= 0) {
    return res
      .status(400)
      .json({ erro: `Campo "${field}" deve ser numérico > 0.` });
  }
  req.body[field] = v;
  next();
};

/** (Opcional) Normaliza string curta; se vier vazia, remove. */
const normalizeOptionalText = (field, max = 120) => (req, _res, next) => {
  const raw = req.body?.[field];
  if (raw === undefined || raw === null) return next();
  const val = String(raw).trim();
  if (!val) {
    delete req.body[field];
    return next();
  }
  req.body[field] = val.slice(0, max);
  next();
};

/** garante ADMIN/MASTER; se role não estiver no token, busca no BD */
async function ensureAdmin(req, res, next) {
  try {
    let role = (
      req.usuario?.funcao_user_role ||
      req.usuario?.funcao ||
      req.usuario?.role ||
      req.user?.role ||
      ""
    )
      .toString()
      .toUpperCase();

    if (!role) {
      const uid = req.usuario?.id || req.user?.id;
      if (!uid) return res.status(401).json({ erro: "Não autenticado." });

      const { rows } = await query(
        `SELECT COALESCE(NULLIF(TRIM(funcao::text), ''), NULLIF(TRIM(role::text), '')) AS role
           FROM public.usuarios
          WHERE id = $1
          LIMIT 1`,
        [uid]
      );
      role = (rows[0]?.role || "").toString().toUpperCase();
    }

    if (!["ADMIN", "MASTER"].includes(role)) {
      return res.status(403).json({ erro: "Acesso negado." });
    }
    return next();
  } catch (e) {
    console.error("ensureAdmin error:", e);
    return res.status(500).json({ erro: "Falha ao validar permissão." });
  }
}

/* =========================
 * SALDO / MOVIMENTOS (usuário)
 * prefixo efetivo: /api/financeiro/...
 * ========================= */
router.get("/saldo", autenticarToken, consultarSaldo);
router.get("/movimentos", autenticarToken, listarMovimentos);

/* ✅ Resumo (saldo + últimos movimentos) — ótimo para a 1ª visita do usuário */
router.get("/resumo", autenticarToken, getResumo);

/* =========================
 * MOVIMENTOS GERAIS (admin)
 * GET /api/financeiro/admin/movimentos
 * ========================= */
router.get(
  "/admin/movimentos",
  autenticarToken,
  ensureAdmin,
  listarMovimentosGeralAdmin
);

/* =========================
 * SAQUE / DEPÓSITO diretos
 * ========================= */
router.post(
  "/saque",
  autenticarToken,
  requireNumeric("valor"),
  normalizeOptionalText("descricao"),
  sacar
);

router.post(
  "/deposito",
  autenticarToken,
  requireNumeric("valor"),
  normalizeOptionalText("descricao"),
  depositar
);

export default router;

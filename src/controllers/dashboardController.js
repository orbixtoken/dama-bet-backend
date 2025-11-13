// src/controllers/dashboard.controller.js
import db from '../models/db.js';

/**
 * GET /api/dashboard/resumo?de=YYYY-MM-DD&ate=YYYY-MM-DD
 *
 * Sem filtros: mostra visão geral do sistema.
 * Com filtros (de/ate): adiciona métricas do período.
 */
export const obterResumoDashboard = async (req, res) => {
  try {
    const { de, ate } = req.query || {};

    // Normaliza datas (opcional)
    const temPeriodo = Boolean(de || ate);
    // Se só tiver "de", usa ate = hoje; se só tiver "ate", usa de = ate (um dia)
    const _de  = de  ? `${de} 00:00:00`  : (ate ? `${ate} 00:00:00` : null);
    const _ate = ate ? `${ate} 23:59:59` : (de  ? `${de} 23:59:59` : null);

    // Monta WHERE de período para apostas (criado_em)
    const filtros = [];
    const params = [];
    let p = 1;

    if (_de)  { filtros.push(`a.criado_em >= $${p++}`); params.push(_de);  }
    if (_ate) { filtros.push(`a.criado_em <= $${p++}`); params.push(_ate); }
    const wherePeriodo = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

    // Uma query com subselects para evitar múltiplas voltas no banco
    const { rows } = await db.query(
      `
      WITH
      -- apostas do período (quando houver)
      ap_periodo AS (
        SELECT a.*
          FROM apostas a
          ${wherePeriodo}
      )
      SELECT
        /* Visão geral (sempre) */
        (SELECT COUNT(*) FROM usuarios WHERE ativo = TRUE)                         AS usuarios_ativos,
        (SELECT COUNT(*) FROM apostas WHERE criado_em::date = CURRENT_DATE)       AS apostas_hoje,
        (SELECT COALESCE(SUM(retorno_real), 0) FROM apostas WHERE status = 'ganha') AS ganhos_totais,
        (SELECT COUNT(*) FROM apostas WHERE status = 'pendente')                  AS apostas_pendentes,
        (SELECT COALESCE(SUM(saldo_disponivel + saldo_bloqueado), 0) FROM saldos) AS banca_total,

        /* Métricas do período (se de/ate for enviado; senão retornam 0) */
        CASE WHEN $${p}::boolean
             THEN (SELECT COUNT(*) FROM ap_periodo)
             ELSE 0
        END AS apostas_no_periodo,

        CASE WHEN $${p}::boolean
             THEN (SELECT COALESCE(SUM(retorno_real), 0) FROM ap_periodo WHERE status = 'ganha')
             ELSE 0
        END AS ganhos_no_periodo,

        CASE WHEN $${p}::boolean
             THEN (SELECT COUNT(*) FROM ap_periodo WHERE status = 'pendente')
             ELSE 0
        END AS pendentes_no_periodo
      `,
      [...params, temPeriodo]
    );

    // Garante formato numérico
    const r = rows[0] || {};
    const resumo = {
      usuariosAtivos: Number(r.usuarios_ativos || 0),
      apostasHoje: Number(r.apostas_hoje || 0),
      ganhosTotais: Number(r.ganhos_totais || 0),
      apostasPendentes: Number(r.apostas_pendentes || 0),
      bancaTotal: Number(r.banca_total || 0),

      // Só fazem sentido se você passou ?de/&ate
      apostasNoPeriodo: Number(r.apostas_no_periodo || 0),
      ganhosNoPeriodo: Number(r.ganhos_no_periodo || 0),
      pendentesNoPeriodo: Number(r.pendentes_no_periodo || 0),
      periodo: temPeriodo ? { de: _de?.slice(0, 10), ate: _ate?.slice(0, 10) } : null,
    };

    return res.status(200).json(resumo);
  } catch (error) {
    console.error('Erro ao obter resumo do dashboard:', error);
    return res
      .status(500)
      .json({ mensagem: 'Erro ao carregar o resumo do dashboard' });
  }
};

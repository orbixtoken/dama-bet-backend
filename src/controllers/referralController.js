// src/controllers/referralController.js
import db from '../models/db.js';

const WEEK_START_SQL = `date_trunc('week', (now() AT TIME ZONE 'UTC'))::date`; // segunda (ISO)

/**
 * GET /api/referrals/me
 * Info do Indique & Ganhe do usuário logado.
 */
export async function myReferralInfo(req, res) {
  const userId = req.usuario?.id;
  if (!userId) return res.status(401).json({ erro: 'Não autenticado.' });

  try {
    // garante referral_code
    const u = await db.query(
      `UPDATE public.usuarios
          SET referral_code = COALESCE(
                referral_code,
                substring(md5(random()::text) FROM 1 FOR 8)
              )
        WHERE id = $1
      RETURNING id, referral_code`,
      [userId]
    );
    const code = u.rows[0]?.referral_code || '';

    const week = await db.query(`SELECT ${WEEK_START_SQL} AS week_start`);
    const weekStart = week.rows[0].week_start;

    // pontos desta semana
    const pts = await db.query(
      `SELECT COALESCE(SUM(points),0)::int AS points
         FROM public.referral_events
        WHERE referrer_user_id = $1
          AND week_start = $2`,
      [userId, weekStart]
    );

    // lista de indicados (nome + "login" do usuário + status do 1º depósito)
    // OBS: removido u.email para não quebrar se a coluna não existir
    const refs = await db.query(
      `SELECT
          r.referred_user_id            AS id,
          u.nome                        AS nome,
          u.usuario                     AS login,
          MIN(r.created_at)             AS joined_at,
          MAX(CASE WHEN r.type = 'first_deposit' THEN r.created_at END) AS first_deposit_at
        FROM public.referral_events r
        LEFT JOIN public.usuarios u ON u.id = r.referred_user_id
       WHERE r.referrer_user_id = $1
       GROUP BY r.referred_user_id, u.nome, u.usuario
       ORDER BY joined_at DESC
       LIMIT 200`,
      [userId]
    );

    return res.json({
      referral_code: code,
      share_link: `${process.env.PUBLIC_SITE_URL || 'http://localhost:5173'}/?ref=${code}`,
      week_start: weekStart,
      week_points: Number(pts.rows[0]?.points || 0),
      referrals: refs.rows || [],
      rules: {
        signup_points: 100,
        first_deposit_points: 500,
        threshold_points: Number(process.env.REF_THRESHOLD || 1000),
        reward_credits: Number(process.env.REF_REWARD_CREDITS || 20),
        min_first_deposit: Number(process.env.REF_MIN_FIRST_DEPOSIT || 50),
      },
    });
  } catch (e) {
    console.error('myReferralInfo erro:', e);
    return res.status(500).json({ erro: 'Falha ao obter informações de afiliado.' });
  }
}

/**
 * GET /api/referrals/history
 * Histórico paginado de eventos de indicação do usuário logado.
 * Query params: page, pageSize
 */
export async function myReferralHistory(req, res) {
  const userId = req.usuario?.id;
  if (!userId) return res.status(401).json({ erro: 'Não autenticado.' });

  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
  const offset = (page - 1) * pageSize;

  try {
    const totalResult = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM public.referral_events
        WHERE referrer_user_id = $1`,
      [userId]
    );
    const total = totalResult.rows[0]?.total || 0;

    const { rows } = await db.query(
      `SELECT
          id,
          referrer_user_id,
          referred_user_id,
          type,
          points,
          amount,
          week_start,
          created_at
         FROM public.referral_events
        WHERE referrer_user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset]
    );

    return res.json({
      items: rows,
      total,
      page,
      pageSize,
    });
  } catch (e) {
    console.error('myReferralHistory erro:', e);
    return res.status(500).json({ erro: 'Falha ao obter histórico de indicações.' });
  }
}

/**
 * POST /api/referrals/claim-weekly
 * Resgata a recompensa semanal (se atingir o limiar de pontos).
 */
export async function claimWeeklyReward(req, res) {
  const userId = req.usuario?.id;
  if (!userId) return res.status(401).json({ erro: 'Não autenticado.' });

  const threshold = Number(process.env.REF_THRESHOLD || 1000);
  const creditValue = Number(process.env.REF_REWARD_CREDITS || 20);

  try {
    const week = await db.query(`SELECT ${WEEK_START_SQL} AS week_start`);
    const weekStart = week.rows[0].week_start;

    // já resgatou?
    const exists = await db.query(
      `SELECT 1
         FROM public.referral_rewards
        WHERE user_id = $1
          AND week_start = $2`,
      [userId, weekStart]
    );
    if (exists.rowCount) {
      return res.status(400).json({ erro: 'Recompensa desta semana já resgatada.' });
    }

    // pontos da semana
    const pts = await db.query(
      `SELECT COALESCE(SUM(points),0)::int AS points
         FROM public.referral_events
        WHERE referrer_user_id = $1
          AND week_start = $2`,
      [userId, weekStart]
    );
    const total = Number(pts.rows[0]?.points || 0);
    if (total < threshold) {
      return res.status(400).json({ erro: 'Pontos insuficientes para resgatar.' });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // registra resgate
      await client.query(
        `INSERT INTO public.referral_rewards
           (user_id, week_start, points_used, credit_value, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [userId, weekStart, threshold, creditValue]
      );

      // garante linha em saldos (contas novas)
      await client.query(
        `INSERT INTO public.saldos (usuario_id, saldo_disponivel, saldo_bloqueado)
         VALUES ($1, 0, 0)
         ON CONFLICT (usuario_id) DO NOTHING`,
        [userId]
      );

      // atualiza saldo e registra movimento
      const s = await client.query(
        `SELECT saldo_disponivel
           FROM public.saldos
          WHERE usuario_id = $1
          FOR UPDATE`,
        [userId]
      );
      const before = Number(s.rows[0]?.saldo_disponivel || 0);
      const after = before + creditValue;

      await client.query(
        `UPDATE public.saldos
            SET saldo_disponivel = $1
          WHERE usuario_id = $2`,
        [after, userId]
      );

      await client.query(
        `INSERT INTO public.financeiro_movimentos
           (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois, criado_em)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          userId,
          'bonus_referral',
          creditValue,
          `Resgate Indique&Ganhe (semana ${weekStart})`,
          before,
          after,
        ]
      );

      await client.query('COMMIT');
      return res.json({ ok: true, credited: creditValue, week_start: weekStart });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('claimWeeklyReward erro (tx):', e);
      return res.status(500).json({ erro: 'Falha ao creditar recompensa.' });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('claimWeeklyReward erro:', e);
    return res.status(500).json({ erro: 'Erro interno.' });
  }
}

export default {
  myReferralInfo,
  myReferralHistory,
  claimWeeklyReward,
};

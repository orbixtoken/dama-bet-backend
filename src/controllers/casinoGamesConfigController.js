// src/controllers/casinoGamesConfigController.js
import db from '../models/db.js';

/**
 * Validações de campo (RTP LIBERADO p/ testes):
 * - rtp_target: 0.00 .. 0.9999 (antes: 0.80..0.99)
 * - min_stake/max_stake: > 0 e max >= min
 * - extra: JSON (pode conter "paytable": [{ mult:number>0, w:number>0 }])
 */
function validatePayload(body, partial = false) {
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  // ---- RTP SEM CLAMP DURO (aceita 0.00..0.9999) ----
  if (!partial || has('rtp_target')) {
    const v = Number(body.rtp_target);
    if (!Number.isFinite(v) || v < 0 || v >= 1) {
      errors.push('rtp_target deve estar entre 0.00 e 0.9999');
    }
  }

  if (!partial || has('min_stake')) {
    const v = Number(body.min_stake);
    if (!Number.isFinite(v) || v <= 0) {
      errors.push('min_stake deve ser > 0');
    }
  }

  if (!partial || has('max_stake')) {
    const v = Number(body.max_stake);
    if (!Number.isFinite(v) || v <= 0) {
      errors.push('max_stake deve ser > 0');
    }
  }

  if ((!partial || (has('min_stake') || has('max_stake'))) &&
      Number(body.max_stake ?? Infinity) < Number(body.min_stake ?? 0)) {
    errors.push('max_stake deve ser >= min_stake');
  }

  if (!partial || has('ativo')) {
    if (has('ativo') && typeof body.ativo !== 'boolean') {
      errors.push('ativo deve ser boolean');
    }
  }

  if (!partial || has('extra')) {
    if (has('extra')) {
      if (typeof body.extra !== 'object' || body.extra === null || Array.isArray(body.extra)) {
        errors.push('extra deve ser um objeto JSON');
      } else if (body.extra.paytable) {
        const pt = body.extra.paytable;
        if (!Array.isArray(pt)) {
          errors.push('extra.paytable deve ser array');
        } else {
          for (const it of pt) {
            if (typeof it !== 'object' || it === null) {
              errors.push('paytable item inválido');
              break;
            }
            const m = Number(it.mult);
            const w = Number(it.w);
            if (!Number.isFinite(m) || m <= 0) errors.push('paytable.mult deve ser > 0');
            if (!Number.isFinite(w) || w <= 0) errors.push('paytable.w deve ser > 0');
          }
        }
      }
    }
  }

  return errors;
}

export async function listGamesConfig(req, res) {
  const { rows } = await db.query(
    `SELECT game_slug, ativo, rtp_target, min_stake, max_stake, extra
       FROM public.casino_games_config
      ORDER BY game_slug`
  );
  return res.json({ items: rows, count: rows.length });
}

export async function getGameConfig(req, res) {
  const { game_slug } = req.params;
  const { rows } = await db.query(
    `SELECT game_slug, ativo, rtp_target, min_stake, max_stake, extra
       FROM public.casino_games_config
      WHERE game_slug = $1`,
    [game_slug]
  );
  if (rows.length === 0) {
    return res.status(404).json({ erro: 'game_slug não encontrado' });
  }
  return res.json(rows[0]);
}

// PUT = upsert por slug (cria ou substitui configuráveis)
export async function upsertGameConfig(req, res) {
  const { game_slug } = req.params;
  const payload = req.body || {};
  const errors = validatePayload(payload, false);
  if (errors.length) return res.status(400).json({ erro: errors.join('; ') });

  const { ativo = true, rtp_target, min_stake, max_stake, extra = {} } = payload;

  const { rows } = await db.query(
    `INSERT INTO public.casino_games_config (game_slug, ativo, rtp_target, min_stake, max_stake, extra)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (game_slug) DO UPDATE
     SET ativo = EXCLUDED.ativo,
         rtp_target = EXCLUDED.rtp_target,
         min_stake = EXCLUDED.min_stake,
         max_stake = EXCLUDED.max_stake,
         extra = EXCLUDED.extra
     RETURNING game_slug, ativo, rtp_target, min_stake, max_stake, extra`,
    [
      game_slug,
      !!ativo,
      Number(rtp_target),
      Number(min_stake),
      Number(max_stake),
      JSON.stringify(extra),
    ]
  );
  return res.status(200).json(rows[0]);
}

// PATCH = atualização parcial
export async function patchGameConfig(req, res) {
  const { game_slug } = req.params;
  const payload = req.body || {};
  const errors = validatePayload(payload, true);
  if (errors.length) return res.status(400).json({ erro: errors.join('; ') });

  // Monta SET dinâmico
  const fields = [];
  const vals = [];
  let idx = 1;

  if (payload.ativo !== undefined) { fields.push(`ativo = $${idx++}`); vals.push(!!payload.ativo); }
  if (payload.rtp_target !== undefined) { fields.push(`rtp_target = $${idx++}`); vals.push(Number(payload.rtp_target)); }
  if (payload.min_stake !== undefined) { fields.push(`min_stake = $${idx++}`); vals.push(Number(payload.min_stake)); }
  if (payload.max_stake !== undefined) { fields.push(`max_stake = $${idx++}`); vals.push(Number(payload.max_stake)); }
  if (payload.extra !== undefined) { fields.push(`extra = $${idx++}::jsonb`); vals.push(JSON.stringify(payload.extra)); }

  if (fields.length === 0) {
    return res.status(400).json({ erro: 'Nada para atualizar' });
  }

  vals.push(game_slug);
  const sql = `
    UPDATE public.casino_games_config
       SET ${fields.join(', ')}
     WHERE game_slug = $${idx}
     RETURNING game_slug, ativo, rtp_target, min_stake, max_stake, extra`;
  const { rows } = await db.query(sql, vals);
  if (rows.length === 0) return res.status(404).json({ erro: 'game_slug não encontrado' });
  return res.json(rows[0]);
}

// "Delete" lógico: inativa o jogo
export async function deactivateGameConfig(req, res) {
  const { game_slug } = req.params;
  const { rows } = await db.query(
    `UPDATE public.casino_games_config
        SET ativo = false
      WHERE game_slug = $1
   RETURNING game_slug, ativo, rtp_target, min_stake, max_stake, extra`,
    [game_slug]
  );
  if (rows.length === 0) return res.status(404).json({ erro: 'game_slug não encontrado' });
  return res.json(rows[0]);
}

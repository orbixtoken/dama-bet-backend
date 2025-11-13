// src/controllers/casinoController.js
import crypto from 'crypto';
import pool, { query, withTransaction } from '../models/db.js';

const GAME_COINFLIP   = 'coinflip';
const GAME_DICE       = 'dice';
const GAME_HILO       = 'hilo';
const GAME_SCRATCH    = 'scratch';
const GAME_SLOTS_COMM = 'slots_common';
const GAME_SLOTS_PREM = 'slots_premium';

// status final aceito em casino_rounds.status
const ROUND_STATUS_FINAL = 'resolvido';

/* ------------------------------------------------------------------
 *                     Provably-fair helpers
 * ------------------------------------------------------------------ */
function genServerSeedHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}
function pfRand01(serverSeed, clientSeed, nonce) {
  const h = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}`).digest('hex');
  const int = parseInt(h.slice(0, 16), 16);
  return int / 0xffffffffffffffff; // [0,1)
}
async function getOrCreateActiveSeed(client, usuarioId, gameSlug) {
  const { rows } = await client.query(
    `SELECT id, usuario_id, game_slug, server_seed, client_seed, nonce, ativo
       FROM public.pf_seeds
      WHERE usuario_id = $1 AND game_slug = $2 AND ativo = TRUE
      LIMIT 1`,
    [usuarioId, gameSlug]
  );
  if (rows.length) return rows[0];
  const serverSeed = genServerSeedHex(32);
  const clientSeed = 'arguz';
  const { rows: ins } = await client.query(
    `INSERT INTO public.pf_seeds (usuario_id, game_slug, server_seed, client_seed, nonce, ativo)
     VALUES ($1, $2, $3, $4, 0, TRUE)
     RETURNING id, usuario_id, game_slug, server_seed, client_seed, nonce, ativo`,
    [usuarioId, gameSlug, serverSeed, clientSeed]
  );
  return ins[0];
}
function buildPfSnapshot({ game, version, pfSeed, extra }) {
  const serverSeedHash = crypto.createHash('sha256').update(pfSeed.server_seed).digest('hex');
  return {
    game,
    version,
    nonce_used: String(pfSeed.nonce),
    pf_seed_id: pfSeed.id ?? null,
    client_seed: pfSeed.client_seed,
    server_seed_hash: serverSeedHash,
    ...(extra || {}),
  };
}

/* ------------------------------------------------------------------
 *                          Helpers comuns
 * ------------------------------------------------------------------ */
async function ensureSaldo(client, usuarioId) {
  await client.query(
    `INSERT INTO public.saldos (usuario_id, saldo_disponivel, saldo_bloqueado)
     VALUES ($1, 0, 0)
     ON CONFLICT (usuario_id) DO NOTHING`,
    [usuarioId]
  );
}
async function getGameConfig(slug) {
  const { rows } = await query(
    `SELECT game_slug, ativo, payout_multiplier, rtp_target, min_stake, max_stake, extra
       FROM public.casino_games_config
      WHERE game_slug = $1`,
    [slug]
  );
  return rows[0] || null;
}
function assertStakeInRange(stake, cfg) {
  if (!Number.isFinite(stake) || stake <= 0) throw new Error('Stake inválida.');
  if (cfg && cfg.ativo === false) throw new Error('Jogo temporariamente indisponível.');
  if (cfg) {
    if (stake < Number(cfg.min_stake)) throw new Error(`Stake mínima: ${cfg.min_stake}.`);
    if (stake > Number(cfg.max_stake)) throw new Error(`Stake máxima: ${cfg.max_stake}.`);
  }
}
async function debitCreditRound(client, { usuarioId, stake, payout, descricaoAposta, descricaoCredito }) {
  const { rows: sal } = await client.query(
    `SELECT saldo_disponivel FROM public.saldos WHERE usuario_id = $1 FOR UPDATE`,
    [usuarioId]
  );
  const saldoAntes = Number(sal[0]?.saldo_disponivel || 0);
  if (saldoAntes < stake) throw new Error('Saldo insuficiente.');

  const depoisAposta = saldoAntes - stake;
  const saldoDepois = depoisAposta + payout;

  // Debita aposta
  await client.query(
    `UPDATE public.saldos SET saldo_disponivel = $1 WHERE usuario_id = $2`,
    [depoisAposta, usuarioId]
  );
  await client.query(
    `INSERT INTO public.financeiro_movimentos
       (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois)
     VALUES ($1, 'aposta', $2, $3, $4, $5)`,
    [usuarioId, stake, descricaoAposta, saldoAntes, depoisAposta]
  );

  // Credita prêmio, se houver
  if (payout > 0) {
    await client.query(
      `UPDATE public.saldos SET saldo_disponivel = $1 WHERE usuario_id = $2`,
      [saldoDepois, usuarioId]
    );
    await client.query(
      `INSERT INTO public.financeiro_movimentos
         (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois)
       VALUES ($1, 'credito', $2, $3, $4, $5)`,
      [usuarioId, payout, descricaoCredito, depoisAposta, saldoDepois]
    );
  }

  return { saldoAntes, saldoDepois };
}
async function insertRound({
  client, usuarioId, gameSlug, stake, payout, lucroCasa, input, outcome, pfSnapshot
}) {
  const { rows: rr } = await client.query(
    `INSERT INTO public.casino_rounds
       (usuario_id, game_slug, aposta_valor, payout_total, lucro_casa,
        status, input_json, outcome_json, pf_snapshot, criado_em, resolvido_em)
     VALUES ($1, $2, $3, $4, $5,
             $6, $7, $8, $9, NOW(), NOW())
     RETURNING id, criado_em`,
    [
      usuarioId,
      gameSlug,
      stake,
      payout,
      lucroCasa,
      ROUND_STATUS_FINAL,
      JSON.stringify(input),
      JSON.stringify(outcome),
      JSON.stringify(pfSnapshot),
    ]
  );
  return rr[0];
}

/* ------------------------------------------------------------------
 *             NOVOS HELPERS para RTP e ajustes de slots
 * ------------------------------------------------------------------ */

/**
 * Converte um RTP alvo (0..1) em probabilidade de vitória p,
 * dado o multiplicador de pagamento (mult):
 *   EV = p * mult ~= rtp_target  =>  p = rtp_target / mult
 */
function winProbFromRTP(rtpTarget, mult) {
  const r = Number(rtpTarget);
  const m = Number(mult);
  if (!Number.isFinite(r) || r < 0) return 0;
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.max(0, Math.min(1, r / m));
}

/**
 * Para Dice: quando perder, gera uma face != target de forma determinística a partir do mesmo r.
 */
function deterministicNonTargetFace(r01, target) {
  const idx = Math.floor(r01 * 5); // 0..4
  const faces = [1, 2, 3, 4, 5, 6].filter(n => n !== target);
  return faces[idx] ?? faces[0];
}

/**
 * Ajusta pesos da paytable para aproximar o RTP alvo.
 * Estratégia simples: escala uniformemente os itens vencedores (mult>0) por um fator k
 * tal que EV' = (k*S)/(k*Wplus + W0) ~ target
 * onde:
 *   S = Σ (w_i * mult_i) para mult_i>0
 *   Wplus = Σ w_i (mult_i>0)
 *   W0 = Σ w_i (mult_i=0)
 */
function retunePaytableForRTP(paytable, rtpTarget) {
  const pt = (Array.isArray(paytable) ? paytable : []).map(x => ({
    mult: Number(x.mult || 0),
    w: Math.max(0, Number(x.w || 0)),
  }));
  if (pt.length === 0) return pt;

  let W0 = 0, Wplus = 0, S = 0;
  for (const it of pt) {
    if (it.mult <= 0) W0 += it.w;
    else { Wplus += it.w; S += it.w * it.mult; }
  }
  if (Wplus <= 0) {
    // tudo zero — cria mínimo para não travar
    pt[0] = { mult: 1, w: 1 };
    Wplus = 1; S = 1;
  }

  const target = Math.max(0, Math.min(0.9999, Number(rtpTarget || 0)));
  // resolver k em: (k*S)/(k*Wplus + W0) = target  =>  k = (target*W0)/(S - target*Wplus)
  let denom = (S - target * Wplus);
  let k = denom > 1e-12 ? (target * W0) / denom : 1;

  if (!Number.isFinite(k) || k <= 0) k = 1;
  if (k > 1e6) k = 1e6;

  const tuned = pt.map(it => (it.mult > 0 ? { ...it, w: it.w * k } : it));

  // normaliza para números razoáveis
  const total = tuned.reduce((a, b) => a + b.w, 0) || 1;
  return tuned.map(it => ({ ...it, w: Math.max(1, Math.round((it.w / total) * 1000)) }));
}

/* ==================================================================
 *                           COINFLIP (RTP)
 * ==================================================================*/
export async function jogarCoinflip(req, res) {
  const usuarioId = req.usuario?.id;
  const stake = Number(req.body?.stake || 0);
  const bet = (req.body?.bet || '').toString().toLowerCase(); // 'heads'|'tails'

  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });
  const cfg = await getGameConfig(GAME_COINFLIP);
  try { assertStakeInRange(stake, cfg); } catch (e) { return res.status(400).json({ erro: e.message }); }
  if (!['heads', 'tails'].includes(bet)) return res.status(400).json({ erro: 'Bet inválida (heads|tails).' });

  try {
    const result = await withTransaction(async (client) => {
      await ensureSaldo(client, usuarioId);

      const seed = await getOrCreateActiveSeed(client, usuarioId, GAME_COINFLIP);
      const r = pfRand01(seed.server_seed, seed.client_seed, seed.nonce);

      const mult = Number(cfg?.payout_multiplier ?? 2.0);
      const pWin = winProbFromRTP(Number(cfg?.rtp_target ?? 0.95), mult); // aplica RTP
      const userWins = r < pWin;

      // Resultado exibido: se win, é a escolha do usuário; se lose, o oposto
      const flip = userWins ? bet : (bet === 'heads' ? 'tails' : 'heads');

      await client.query(`UPDATE public.pf_seeds SET nonce = nonce + 1 WHERE id = $1`, [seed.id]);

      const payout = userWins ? stake * mult : 0;
      const lucroCasa = stake - payout;

      const { saldoAntes, saldoDepois } = await debitCreditRound(client, {
        usuarioId,
        stake,
        payout,
        descricaoAposta: `Coinflip aposta em ${bet}`,
        descricaoCredito: `Coinflip vitória (${flip})`,
      });

      const pfSnapshot = buildPfSnapshot({
        game: GAME_COINFLIP,
        version: 2,
        pfSeed: seed,
        extra: { input: { bet, stake, mult, pWin }, outcome: { result: flip, payout, r } },
      });

      const round = await insertRound({
        client, usuarioId, gameSlug: GAME_COINFLIP, stake, payout, lucroCasa,
        input: { bet, stake, mult, pWin }, outcome: { result: flip, payout, r }, pfSnapshot,
      });

      return {
        round_id: round.id, game: GAME_COINFLIP, bet, result: flip, stake, payout,
        saldo_antes: saldoAntes, saldo_depois: saldoDepois, created_at: round.criado_em,
      };
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err?.message === 'Saldo insuficiente.') {
      return res.status(400).json({ erro: 'Saldo insuficiente.' });
    }
    console.error('Erro jogarCoinflip:', err);
    return res.status(500).json({ erro: 'Erro ao jogar Coinflip.' });
  }
}

/* ==================================================================
 *                             DICE (RTP)
 * ==================================================================*/
export async function jogarDice(req, res) {
  const usuarioId = req.usuario?.id;
  const stake = Number(req.body?.stake || 0);
  const target = Number(req.body?.target || 0);

  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });
  const cfg = await getGameConfig(GAME_DICE);
  try { assertStakeInRange(stake, cfg); } catch (e) { return res.status(400).json({ erro: e.message }); }
  if (!Number.isInteger(target) || target < 1 || target > 6) {
    return res.status(400).json({ erro: 'Target inválido (1..6).' });
  }

  try {
    const result = await withTransaction(async (client) => {
      await ensureSaldo(client, usuarioId);

      const seed = await getOrCreateActiveSeed(client, usuarioId, GAME_DICE);
      const r = pfRand01(seed.server_seed, seed.client_seed, seed.nonce);
      await client.query(`UPDATE public.pf_seeds SET nonce = nonce + 1 WHERE id = $1`, [seed.id]);

      const mult = Number(cfg?.extra?.six_exact_multiplier ?? 6.0);
      const pWin = winProbFromRTP(Number(cfg?.rtp_target ?? 0.90), mult); // aplica RTP

      const userWins = r < pWin;

      // Se win, mostra exatamente o target; se lose, gera uma face diferente do target
      const roll = userWins ? target : deterministicNonTargetFace(r, target);

      const payout = userWins ? stake * mult : 0;
      const lucroCasa = stake - payout;

      const { saldoAntes, saldoDepois } = await debitCreditRound(client, {
        usuarioId,
        stake,
        payout,
        descricaoAposta: `Dice aposta no ${target}`,
        descricaoCredito: `Dice vitória (roll ${roll})`,
      });

      const pfSnapshot = buildPfSnapshot({
        game: GAME_DICE, version: 2, pfSeed: seed,
        extra: { input: { target, stake, mult, pWin }, outcome: { roll, payout, r } },
      });

      const round = await insertRound({
        client, usuarioId, gameSlug: GAME_DICE, stake, payout, lucroCasa,
        input: { target, stake, mult, pWin }, outcome: { roll, payout, r }, pfSnapshot,
      });

      return {
        round_id: round.id, game: GAME_DICE, target, roll, stake, payout,
        saldo_antes: saldoAntes, saldo_depois: saldoDepois, created_at: round.criado_em,
      };
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err?.message === 'Saldo insuficiente.') {
      return res.status(400).json({ erro: 'Saldo insuficiente.' });
    }
    console.error('Erro jogarDice:', err);
    return res.status(500).json({ erro: 'Erro ao jogar Dice.' });
  }
}

/* ==================================================================
 *                               HILO
 * ==================================================================*/
export async function jogarHiLo(req, res) {
  const usuarioId = req.usuario?.id;
  const stake = Number(req.body?.stake || 0);
  const choice = (req.body?.choice || '').toString().toLowerCase(); // 'high' | 'low'

  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });
  const cfg = await getGameConfig(GAME_HILO);
  try { assertStakeInRange(stake, cfg); } catch (e) { return res.status(400).json({ erro: e.message }); }
  if (!['high', 'low'].includes(choice)) {
    return res.status(400).json({ erro: 'Choice inválido (high|low).' });
  }

  try {
    const result = await withTransaction(async (client) => {
      await ensureSaldo(client, usuarioId);

      const seed = await getOrCreateActiveSeed(client, usuarioId, GAME_HILO);
      const r = pfRand01(seed.server_seed, seed.client_seed, seed.nonce);
      const outcome = r > 0.5 ? 'high' : 'low';

      await client.query(`UPDATE public.pf_seeds SET nonce = nonce + 1 WHERE id = $1`, [seed.id]);

      const mult = Number(cfg?.payout_multiplier ?? 1.95);
      const payout = (outcome === choice) ? stake * mult : 0;
      const lucroCasa = stake - payout;

      const { saldoAntes, saldoDepois } = await debitCreditRound(client, {
        usuarioId,
        stake,
        payout,
        descricaoAposta: `HiLo aposta em ${choice}`,
        descricaoCredito: `HiLo vitória (${outcome})`,
      });

      const pfSnapshot = buildPfSnapshot({
        game: GAME_HILO, version: 1, pfSeed: seed,
        extra: { input: { choice, stake, mult }, outcome: { r, outcome, payout } },
      });

      const round = await insertRound({
        client, usuarioId, gameSlug: GAME_HILO, stake, payout, lucroCasa,
        input: { choice, stake, mult }, outcome: { r, outcome, payout }, pfSnapshot,
      });

      return {
        round_id: round.id, game: GAME_HILO, choice, outcome, stake, payout,
        saldo_antes: saldoAntes, saldo_depois: saldoDepois, created_at: round.criado_em,
      };
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err?.message === 'Saldo insuficiente.') {
      return res.status(400).json({ erro: 'Saldo insuficiente.' });
    }
    console.error('Erro jogarHiLo:', err);
    return res.status(500).json({ erro: 'Erro ao jogar HiLo.' });
  }
}

/* ==================================================================
 *                            SCRATCH (Raspadinha)
 * extra.prize_table: [{payout:mult, weight:int}, ...]
 * ==================================================================*/
export async function jogarScratch(req, res) {
  const usuarioId = req.usuario?.id;
  const stake = Number(req.body?.stake || 0);

  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });
  const cfg = await getGameConfig(GAME_SCRATCH);
  try { assertStakeInRange(stake, cfg); } catch (e) { return res.status(400).json({ erro: e.message }); }

  // paytable default caso não exista no extra
  const table = Array.isArray(cfg?.extra?.prize_table) && cfg.extra.prize_table.length
    ? cfg.extra.prize_table
    : [
        { payout: 0,   weight: 70 },
        { payout: 0.5, weight: 15 },
        { payout: 1.0, weight: 8  },
        { payout: 2.0, weight: 5  },
        { payout: 10,  weight: 2  },
      ];

  try {
    const result = await withTransaction(async (client) => {
      await ensureSaldo(client, usuarioId);

      const seed = await getOrCreateActiveSeed(client, usuarioId, GAME_SCRATCH);
      const r = pfRand01(seed.server_seed, seed.client_seed, seed.nonce);
      await client.query(`UPDATE public.pf_seeds SET nonce = nonce + 1 WHERE id = $1`, [seed.id]);

      // sorteio ponderado
      const totalWeight = table.reduce((s, t) => s + Number(t.weight || 0), 0);
      let acc = 0, chosen = table[0];
      const pick = r * totalWeight;
      for (const item of table) {
        acc += Number(item.weight || 0);
        if (pick <= acc) { chosen = item; break; }
      }

      const mult = Number(chosen.payout || 0);
      const payout = stake * mult;
      const lucroCasa = stake - payout;

      const { saldoAntes, saldoDepois } = await debitCreditRound(client, {
        usuarioId,
        stake,
        payout,
        descricaoAposta: 'Raspadinha',
        descricaoCredito: `Raspadinha prêmio x${mult}`,
      });

      const pfSnapshot = buildPfSnapshot({
        game: GAME_SCRATCH, version: 1, pfSeed: seed,
        extra: { input: { stake }, outcome: { mult, payout } },
      });

      const round = await insertRound({
        client, usuarioId, gameSlug: GAME_SCRATCH, stake, payout, lucroCasa,
        input: { stake }, outcome: { mult, payout }, pfSnapshot,
      });

      return {
        round_id: round.id, game: GAME_SCRATCH, stake, payout, mult,
        saldo_antes: saldoAntes, saldo_depois: saldoDepois, created_at: round.criado_em,
      };
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err?.message === 'Saldo insuficiente.') {
      return res.status(400).json({ erro: 'Saldo insuficiente.' });
    }
    console.error('Erro jogarScratch:', err);
    return res.status(500).json({ erro: 'Erro ao jogar Raspadinha.' });
  }
}

/* ==================================================================
 *                      SLOTS (Common/Premium) c/ RTP
 * Usa RTP alvo (rtp_target) e/ou paytable em extra.paytable
 * Formato paytable (se existir): [{mult:number, w:int}, ...]
 * ==================================================================*/
async function jogarSlotsGeneric(req, res, gameSlug) {
  const usuarioId = req.usuario?.id;
  const stake = Number(req.body?.stake || 0);

  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });
  const cfg = await getGameConfig(gameSlug);
  try { assertStakeInRange(stake, cfg); } catch (e) { return res.status(400).json({ erro: e.message }); }

  // paytable base (painel ou defaults)
  let paytable = Array.isArray(cfg?.extra?.paytable) && cfg.extra.paytable.length
    ? cfg.extra.paytable
    : (gameSlug === GAME_SLOTS_PREM
        ? [ {mult:0, w:66}, {mult:1.2, w:20}, {mult:2, w:8}, {mult:5, w:5}, {mult:25, w:1} ] // ~0.92 base
        : [ {mult:0, w:64}, {mult:1.2, w:22}, {mult:2, w:9}, {mult:5, w:4}, {mult:20, w:1} ]); // ~0.93 base

  // *** Ajuste para bater RTP alvo ***
  const rtpTarget = Number(cfg?.rtp_target ?? 0.93);
  paytable = retunePaytableForRTP(paytable, rtpTarget);

  try {
    const result = await withTransaction(async (client) => {
      await ensureSaldo(client, usuarioId);

      const seed = await getOrCreateActiveSeed(client, usuarioId, gameSlug);
      const r = pfRand01(seed.server_seed, seed.client_seed, seed.nonce);
      await client.query(`UPDATE public.pf_seeds SET nonce = nonce + 1 WHERE id = $1`, [seed.id]);

      const totalW = paytable.reduce((s, x) => s + Number(x.w || 0), 0);
      let acc = 0, hit = paytable[0];
      const pick = r * totalW;
      for (const item of paytable) {
        acc += Number(item.w || 0);
        if (pick <= acc) { hit = item; break; }
      }

      const mult = Number(hit.mult || 0);
      const payout = stake * mult;
      const lucroCasa = stake - payout;

      const { saldoAntes, saldoDepois } = await debitCreditRound(client, {
        usuarioId,
        stake,
        payout,
        descricaoAposta: `Slots ${gameSlug === GAME_SLOTS_PREM ? 'Premium' : 'Common'}`,
        descricaoCredito: `Slots prêmio x${mult}`,
      });

      const pfSnapshot = buildPfSnapshot({
        game: gameSlug, version: 2, pfSeed: seed,
        extra: { input: { stake, rtpTarget }, outcome: { mult, payout }, paytableUsed: paytable },
      });

      const round = await insertRound({
        client, usuarioId, gameSlug, stake, payout, lucroCasa,
        input: { stake, rtpTarget }, outcome: { mult, payout }, pfSnapshot,
      });

      return {
        round_id: round.id, game: gameSlug, stake, payout, mult,
        saldo_antes: saldoAntes, saldo_depois: saldoDepois, created_at: round.criado_em,
      };
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err?.message === 'Saldo insuficiente.') {
      return res.status(400).json({ erro: 'Saldo insuficiente.' });
    }
    console.error(`Erro jogarSlots (${gameSlug}):`, err);
    return res.status(500).json({ erro: 'Erro ao jogar Slots.' });
  }
}
export function jogarSlotsCommon(req, res)  { return jogarSlotsGeneric(req, res, GAME_SLOTS_COMM); }
export function jogarSlotsPremium(req, res) { return jogarSlotsGeneric(req, res, GAME_SLOTS_PREM); }

/* ==================================================================
 *                        Listagens rápidas por jogo
 * ==================================================================*/
async function listarPorSlug(req, res, slug) {
  const usuarioId = req.usuario?.id;
  if (!usuarioId) return res.status(401).json({ erro: 'Não autenticado.' });
  try {
    const { rows } = await query(
      `SELECT id, game_slug, aposta_valor AS stake, payout_total, lucro_casa,
              status, input_json, outcome_json, criado_em, resolvido_em
         FROM public.casino_rounds
        WHERE usuario_id = $1 AND game_slug = $2
        ORDER BY criado_em DESC
        LIMIT 100`,
      [usuarioId, slug]
    );
    res.json(rows);
  } catch (e) {
    console.error('Erro listar rounds:', e);
    res.status(500).json({ erro: 'Erro ao listar rounds.' });
  }
}
export function listarMinhasCoinflip(req, res)     { return listarPorSlug(req, res, GAME_COINFLIP); }
export function listarMinhasDice(req, res)         { return listarPorSlug(req, res, GAME_DICE); }
export function listarMinhasHiLo(req, res)         { return listarPorSlug(req, res, GAME_HILO); }
export function listarMinhasScratch(req, res)      { return listarPorSlug(req, res, GAME_SCRATCH); }
export function listarMinhasSlotsCommon(req, res)  { return listarPorSlug(req, res, GAME_SLOTS_COMM); }
export function listarMinhasSlotsPremium(req, res) { return listarPorSlug(req, res, GAME_SLOTS_PREM); }

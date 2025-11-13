// src/controllers/pfSeedController.js
import db from '../models/db.js';
import crypto from 'crypto';
import { AppError } from '../middlewares/error.middleware.js';

/**
 * Gera uma seed de 64 chars hex.
 */
function genSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Garante que o usuário tem uma seed ativa para o jogo.
 * Retorna a linha (com hash calculado pela coluna gerada do PG).
 */
export async function ensureActiveSeed(client, usuarioId, gameSlug) {
  const { rows } = await client.query(
    `SELECT * FROM public.pf_seeds
      WHERE usuario_id = $1 AND game_slug = $2 AND ativo = TRUE
      LIMIT 1`,
    [usuarioId, gameSlug]
  );
  if (rows.length) return rows[0];

  const serverSeed = genSeed();
  const { rows: ins } = await client.query(
    `INSERT INTO public.pf_seeds (usuario_id, game_slug, server_seed, client_seed, nonce, ativo)
     VALUES ($1, $2, $3, 'arguz', 0, TRUE)
     RETURNING *`,
    [usuarioId, gameSlug, serverSeed]
  );
  return ins[0];
}

/**
 * GET /api/pf-seeds/:gameSlug/me
 * Retorna a seed ativa (apenas HASH do server_seed), client_seed e nonce.
 */
export async function getMySeed(req, res, next) {
  try {
    const usuarioId = req.usuario?.id;
    const gameSlug = (req.params.gameSlug || '').toString();
    if (!usuarioId) throw new AppError('Não autenticado.', 401);
    if (!gameSlug) throw new AppError('gameSlug é obrigatório.', 400);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const seed = await ensureActiveSeed(client, usuarioId, gameSlug);
      await client.query('COMMIT');

      return res.json({
        game: seed.game_slug,
        server_seed_hash: seed.server_seed_h, // coluna gerada no PG
        client_seed: seed.client_seed,
        nonce: Number(seed.nonce),
        criado_em: seed.criado_em,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/pf-seeds/:gameSlug/rotate
 * Rotaciona a seed: desativa a atual e cria uma nova.
 * Retorna o server_seed ANTIGO (reveal) + hash correspondente (prova).
 */
export async function rotateMySeed(req, res, next) {
  try {
    const usuarioId = req.usuario?.id;
    const gameSlug = (req.params.gameSlug || '').toString();
    if (!usuarioId) throw new AppError('Não autenticado.', 401);
    if (!gameSlug) throw new AppError('gameSlug é obrigatório.', 400);

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // pega seed ativa atual
      const oldSeed = await ensureActiveSeed(client, usuarioId, gameSlug);

      // desativa atual
      await client.query(
        `UPDATE public.pf_seeds SET ativo = FALSE WHERE id = $1`,
        [oldSeed.id]
      );

      // cria nova
      const newServer = genSeed();
      const { rows: ins } = await client.query(
        `INSERT INTO public.pf_seeds (usuario_id, game_slug, server_seed, client_seed, nonce, ativo)
         VALUES ($1, $2, $3, 'arguz', 0, TRUE)
         RETURNING *`,
        [usuarioId, gameSlug, newServer]
      );

      await client.query('COMMIT');

      // devolve REVEAL da antiga
      return res.json({
        rotated: true,
        reveal_previous: {
          server_seed: oldSeed.server_seed,
          server_seed_hash: oldSeed.server_seed_h,
          client_seed: oldSeed.client_seed,
          last_nonce: Number(oldSeed.nonce),
        },
        new_seed: {
          server_seed_hash: ins[0].server_seed_h,
          client_seed: ins[0].client_seed,
          nonce: Number(ins[0].nonce),
        },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/pf-seeds/:gameSlug/client
 * body: { client_seed: string }
 */
export async function setClientSeed(req, res, next) {
  try {
    const usuarioId = req.usuario?.id;
    const gameSlug = (req.params.gameSlug || '').toString();
    const clientSeed = (req.body?.client_seed ?? '').toString().slice(0, 100);

    if (!usuarioId) throw new AppError('Não autenticado.', 401);
    if (!gameSlug) throw new AppError('gameSlug é obrigatório.', 400);
    if (!clientSeed) throw new AppError('client_seed é obrigatório.', 400);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const seed = await ensureActiveSeed(client, usuarioId, gameSlug);

      const { rows: up } = await client.query(
        `UPDATE public.pf_seeds
            SET client_seed = $1
          WHERE id = $2
          RETURNING server_seed_h, client_seed, nonce`,
        [clientSeed, seed.id]
      );

      await client.query('COMMIT');
      return res.json({
        message: 'client_seed atualizado.',
        server_seed_hash: up[0].server_seed_h,
        client_seed: up[0].client_seed,
        nonce: Number(up[0].nonce),
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

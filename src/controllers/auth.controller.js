// src/controllers/auth.controller.js
import bcrypt from 'bcryptjs'; // ou 'bcryptjs'
import db from '../models/db.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
  decode,
} from '../utils/tokenUtils.js';

/* util: normaliza strings */
const s = (v) => (v ?? '').toString().trim();

/* =========================================================
 * POST /api/auth/signup
 * body: { nome, usuario, senha }
 * resp: { accessToken, refreshToken, usuario, ... }
 * - cria usuário ativo com funcao 'USER' (nunca ADMIN)
 * - garante unicidade de usuario
 * - cria registro em saldos (0)
 * =======================================================*/
export const signupUsuario = async (req, res) => {
  const nome = s(req.body?.nome);
  const rawUsuario = s(req.body?.usuario).toLowerCase();
  const senha = s(req.body?.senha);

  if (!nome || !rawUsuario || !senha) {
    return res
      .status(400)
      .json({ erro: 'Nome, usuário e senha são obrigatórios.' });
  }

  // aqui seguimos o padrão que você vem usando: usuario É um e-mail,
  // só que armazenado na coluna "usuario"
  if (!/\S+@\S+\.\S+/.test(rawUsuario)) {
    return res
      .status(400)
      .json({ erro: 'Usuário deve ser um e-mail válido.' });
  }

  if (senha.length < 6) {
    return res
      .status(400)
      .json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });
  }

  const usuario = rawUsuario;

  try {
    await db.query('BEGIN');

    // 1) checa duplicidade de usuario (case-insensitive)
    const { rows: dup } = await db.query(
      `SELECT id FROM public.usuarios
        WHERE LOWER(usuario) = $1
        LIMIT 1`,
      [usuario]
    );
    if (dup.length) {
      await db.query('ROLLBACK');
      return res.status(409).json({ erro: 'Usuário já cadastrado.' });
    }

    // 2) hash da senha
    const senha_hash = await bcrypt.hash(senha, 10);

    // 3) cria usuário (sempre USER e ativo) – sem coluna email
    const { rows: urows } = await db.query(
      `INSERT INTO public.usuarios
         (usuario, nome, funcao, senha_hash, ativo, criado_em)
       VALUES ($1, $2, 'USER', $3, TRUE, NOW())
       RETURNING id, usuario, nome, funcao, ativo`,
      [usuario, nome, senha_hash]
    );
    const user = urows[0];

    // 4) cria saldo zero
    await db.query(
      `INSERT INTO public.saldos (usuario_id, saldo_disponivel, saldo_bloqueado)
       VALUES ($1, 0, 0)
       ON CONFLICT (usuario_id) DO NOTHING`,
      [user.id]
    );

    // 5) emite tokens e registra refresh
    const payload = {
      id: user.id,
      usuario: user.usuario,
      nome: user.nome,
      funcao_user_role: user.funcao, // 'USER'
    };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken({ id: user.id });

    const hashed = hashToken(refreshToken);
    const decoded = decode(refreshToken);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : null;

    const uaRaw = req.headers['user-agent'] || null;
    const userAgent = typeof uaRaw === 'string' ? uaRaw.slice(0, 255) : null;
    const ip = (req.ip || '').toString().slice(0, 64) || null;

    await db.query(
      `INSERT INTO refresh_tokens (user_id, hashed_token, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, hashed, expiresAt, userAgent, ip]
    );

    await db.query('COMMIT');

    return res.status(201).json({
      mensagem: 'Conta criada com sucesso.',
      accessToken,
      refreshToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      usuario: {
        id: user.id,
        nome: user.nome,
        usuario: user.usuario,
        funcao: user.funcao, // USER
        email: null, // mantemos campo para compat, mas sempre null (não há coluna)
        ativo: user.ativo,
      },
    });
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('Erro no signup:', error);
    return res.status(500).json({ erro: 'Erro interno ao criar conta.' });
  }
};

/**
 * POST /api/auth/login
 * body: { usuario, senha }
 * resp: { accessToken, refreshToken, usuario, access_token, refresh_token }
 */
export const loginUsuario = async (req, res) => {
  const rawUsuario = s(req.body?.usuario).toLowerCase();
  const senha = s(req.body?.senha);

  if (!rawUsuario || !senha) {
    return res.status(400).json({ erro: 'Usuário e senha são obrigatórios.' });
  }

  try {
    // Busca APENAS por usuario (coluna "usuario"), sem usar coluna email
    const result = await db.query(
      `SELECT id, usuario, nome, funcao, senha_hash, cpf, telefone, ativo
         FROM usuarios
        WHERE LOWER(usuario) = $1
          AND ativo = true
        LIMIT 1`,
      [rawUsuario]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const user = result.rows[0];
    const senhaValida = await bcrypt.compare(
      senha,
      String(user.senha_hash || '')
    );
    if (!senhaValida) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const payload = {
      id: user.id,
      usuario: user.usuario,
      nome: user.nome,
      funcao_user_role: user.funcao,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken({ id: user.id });

    const hashed = hashToken(refreshToken);
    const decoded = decode(refreshToken);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : null;

    const uaRaw = req.headers['user-agent'] || null;
    const userAgent = typeof uaRaw === 'string' ? uaRaw.slice(0, 255) : null;
    const ip = (req.ip || '').toString().slice(0, 64) || null;

    await db.query(
      `INSERT INTO refresh_tokens (user_id, hashed_token, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, hashed, expiresAt, userAgent, ip]
    );

    return res.json({
      mensagem: 'Login realizado com sucesso.',
      accessToken,
      refreshToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      usuario: {
        id: user.id,
        nome: user.nome,
        usuario: user.usuario,
        funcao: user.funcao,
        cpf: user.cpf,
        telefone: user.telefone,
        email: null, // não temos coluna email, devolvemos null por padrão
      },
    });
  } catch (error) {
    console.error('Erro ao realizar login:', error);
    return res.status(500).json({ erro: 'Erro interno ao realizar login.' });
  }
};

/**
 * POST /api/auth/refresh
 * body: { refreshToken }
 */
export const refreshToken = async (req, res) => {
  const incoming = req.body?.refreshToken || req.body?.refresh_token;
  if (!incoming) {
    return res.status(400).json({ erro: 'refreshToken é obrigatório.' });
  }

  try {
    const decoded = verifyRefreshToken(incoming);
    const userId = decoded.id;

    const hashed = hashToken(incoming);
    const { rows } = await db.query(
      `SELECT id
         FROM refresh_tokens
        WHERE hashed_token = $1
          AND revoked = false
          AND expires_at > NOW()
        LIMIT 1`,
      [hashed]
    );
    const tokenRow = rows[0];
    if (!tokenRow) {
      return res
        .status(401)
        .json({ erro: 'Refresh token inválido ou revogado.' });
    }

    const newRefresh = generateRefreshToken({ id: userId });
    const newHashed = hashToken(newRefresh);
    const newDecoded = decode(newRefresh);
    const newExpires = newDecoded?.exp
      ? new Date(newDecoded.exp * 1000)
      : null;

    const uaRaw = req.headers['user-agent'] || null;
    const userAgent = typeof uaRaw === 'string' ? uaRaw.slice(0, 255) : null;
    const ip = (req.ip || '').toString().slice(0, 64) || null;

    await db.query('BEGIN');

    await db.query(
      `UPDATE refresh_tokens
          SET revoked = true,
              replaced_by_token = $1
        WHERE id = $2`,
      [newHashed, tokenRow.id]
    );

    await db.query(
      `INSERT INTO refresh_tokens (user_id, hashed_token, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, newHashed, newExpires, userAgent, ip]
    );

    const u = await db.query(
      'SELECT id, usuario, nome, funcao FROM usuarios WHERE id = $1 LIMIT 1',
      [userId]
    );
    const user = u.rows[0];
    if (!user) {
      await db.query('ROLLBACK');
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const payload = {
      id: user.id,
      usuario: user.usuario,
      nome: user.nome,
      funcao_user_role: user.funcao,
    };
    const newAccess = generateAccessToken(payload);

    await db.query('COMMIT');

    return res.json({
      accessToken: newAccess,
      refreshToken: newRefresh,
      access_token: newAccess,
      refresh_token: newRefresh,
    });
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('Erro no refresh:', error);
    return res
      .status(401)
      .json({ erro: 'Refresh token inválido ou expirado.' });
  }
};

/**
 * POST /api/auth/logout
 * body: { refreshToken }
 */
export const logout = async (req, res) => {
  const incoming = req.body?.refreshToken || req.body?.refresh_token;
  if (!incoming) {
    return res.status(400).json({ erro: 'refreshToken é obrigatório.' });
  }

  try {
    const hashed = hashToken(incoming);
    await db.query(
      `UPDATE refresh_tokens
          SET revoked = true
        WHERE hashed_token = $1
          AND revoked = false`,
      [hashed]
    );

    return res.json({ mensagem: 'Logout efetuado.' });
  } catch (error) {
    console.error('Erro no logout:', error);
    return res.status(500).json({ erro: 'Erro interno ao efetuar logout.' });
  }
};

/**
 * POST /api/auth/logout-all
 * header: Authorization: Bearer <access>
 */
export const logoutAll = async (req, res) => {
  try {
    const userId = req.usuario?.id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }

    await db.query(
      `UPDATE refresh_tokens
          SET revoked = true
        WHERE user_id = $1
          AND revoked = false`,
      [userId]
    );

    return res.json({ mensagem: 'Todas as sessões foram encerradas.' });
  } catch (error) {
    console.error('Erro no logout-all:', error);
    return res
      .status(500)
      .json({ erro: 'Erro interno ao encerrar sessões.' });
  }
};

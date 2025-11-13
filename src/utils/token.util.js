// src/utils/token.util.js
import jwt from 'jsonwebtoken';

/**
 * Assina o access token.
 * Por padrão expira em 15m (pode mudar via env ACCESS_TOKEN_EXPIRES).
 */
export function signAccessToken(user) {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  const expiresIn = process.env.ACCESS_TOKEN_EXPIRES || '15m';

  // payload mínimo seguro e suficiente
  const payload = {
    sub: String(user.id),
    nome: user.nome,
    email: user.email,
    funcao: user.funcao || user.role || 'USER',
  };

  return jwt.sign(payload, secret, { expiresIn });
}

/**
 * Assina o refresh token.
 * Por padrão expira em 30d (env REFRESH_TOKEN_EXPIRES).
 */
export function signRefreshToken(user) {
  const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'dev-secret-refresh';
  const expiresIn = process.env.REFRESH_TOKEN_EXPIRES || '30d';

  const payload = { sub: String(user.id) };
  return jwt.sign(payload, secret, { expiresIn });
}

/**
 * Função usada pelo login e pelo signup público para emitir os dois tokens.
 */
export async function issueTokensForUser(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  return { accessToken, refreshToken };
}

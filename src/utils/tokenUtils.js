// src/utils/tokenUtils.js
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const ACCESS_TTL  = process.env.JWT_EXPIRES_IN || '15m';   // ex.: '12h' se preferir
const REFRESH_TTL = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

const ACCESS_SECRET  = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (
  process.env.JWT_SECRET ? process.env.JWT_SECRET + '_refresh' : undefined
);

// ✅ Falha cedo se faltar segredo
if (!ACCESS_SECRET) {
  throw new Error('JWT_SECRET não definido no .env');
}
if (!REFRESH_SECRET) {
  throw new Error('JWT_REFRESH_SECRET não definido e fallback indisponível (defina JWT_SECRET).');
}

/** Hash seguro do token (armazenamos só o hash no banco) */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Gera ACCESS token (curta duração) */
export function generateAccessToken(payload, expiresIn = ACCESS_TTL) {
  return jwt.sign(payload, ACCESS_SECRET, {
    expiresIn,
    algorithm: 'HS256',
  });
}

/** Gera REFRESH token (longa duração) */
export function generateRefreshToken(payload, expiresIn = REFRESH_TTL) {
  const withType = { ...payload, type: 'refresh' };
  return jwt.sign(withType, REFRESH_SECRET, {
    expiresIn,
    algorithm: 'HS256',
  });
}

/** Verifica ACCESS token */
export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

/** Verifica REFRESH token */
export function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, REFRESH_SECRET);
  if (decoded?.type !== 'refresh') {
    throw new Error('Token não é do tipo refresh.');
  }
  return decoded;
}

/** Decodifica sem verificar (útil para pegar exp) */
export function decode(token) {
  return jwt.decode(token);
}

/** Compat c/ projeto existente */
export function gerarToken(payload) {
  return generateAccessToken(payload);
}
export function verificarToken(token) {
  return verifyAccessToken(token);
}

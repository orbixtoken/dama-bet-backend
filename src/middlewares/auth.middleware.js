// src/middlewares/auth.middleware.js
import { verificarToken } from '../utils/tokenUtils.js';

/** Normaliza uma role: remove acento, trim e upper-case */
const normalizeRole = (role) =>
  role
    ? role.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim()
    : '';

/** Converte qualquer entrada em uma LISTA de roles normalizadas */
const toRoleList = (input) => {
  if (!input && input !== 0) return [];
  if (Array.isArray(input)) {
    return input.flat().map(normalizeRole).filter(Boolean);
  }
  const s = String(input);
  if (s.includes(',')) {
    return s.split(',').map(normalizeRole).filter(Boolean);
  }
  return [normalizeRole(s)].filter(Boolean);
};

/**
 * Autentica o JWT enviado no header Authorization.
 * Aceita "Bearer <token>" (case-insensitive) ou, em último caso, apenas o token cru.
 * Preenche: req.usuario, req.user (compat), req.userId, req.role
 */
export const autenticarToken = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  let token;

  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
      token = parts[1];
    } else if (parts.length === 1) {
      token = parts[0];
    }
  }

  if (!token) {
    return res.status(401).json({ erro: 'Token não fornecido.' });
  }

  try {
    const decoded = verificarToken(token);

    req.usuario = decoded;
    req.user = decoded;
    req.userId = decoded.id;

    // Normaliza role de várias possibilidades e usa fallback 'USUARIO'
    const rawRole =
      decoded.funcao_user_role ||
      decoded.funcao ||
      decoded.role ||
      'USUARIO';

    req.role = normalizeRole(rawRole);

    return next();
  } catch (err) {
    const isExpired = err?.name === 'TokenExpiredError';
    const message = isExpired ? 'Token expirado.' : 'Token inválido.';
    return res.status(401).json({ erro: message });
  }
};

/**
 * Restringe acesso por roles.
 * Exemplos válidos:
 *   autorizarRoles('ADMIN', 'MASTER')
 *   autorizarRoles(['ADMIN', 'MASTER'])
 *   autorizarRoles('ADMIN,MASTER')
 */
export const autorizarRoles = (...funcoesPermitidas) => {
  let allowed = [];
  for (const arg of funcoesPermitidas) {
    allowed = allowed.concat(toRoleList(arg));
  }
  allowed = Array.from(new Set(allowed)).filter(Boolean);

  return (req, res, next) => {
    const roleAtual =
      req.role ||
      normalizeRole(
        req.usuario?.funcao_user_role ||
        req.user?.funcao_user_role ||
        req.usuario?.funcao ||
        req.user?.funcao ||
        req.usuario?.role ||
        req.user?.role ||
        'USUARIO'
      );

    if (!roleAtual) {
      return res.status(403).json({ erro: 'Acesso negado. Permissão ausente.' });
    }

    if (!allowed.includes(roleAtual)) {
      return res.status(403).json({
        erro: 'Acesso negado. Permissão insuficiente.',
        roleAtual,
        permitido: allowed,
      });
    }

    return next();
  };
};

/**
 * Middleware pronto para rotas apenas para ADMIN
 */
export const ensureAdmin = autorizarRoles('ADMIN');

// Export padrão para compatibilidade
export default { autenticarToken, autorizarRoles, ensureAdmin };

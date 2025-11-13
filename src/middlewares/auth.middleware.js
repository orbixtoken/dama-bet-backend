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
  // Array: achata e normaliza
  if (Array.isArray(input)) {
    return input.flat().map(normalizeRole).filter(Boolean);
  }
  // String: pode conter vírgulas
  const s = String(input);
  if (s.includes(',')) {
    return s.split(',').map(normalizeRole).filter(Boolean);
  }
  // Único valor
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
      // tolera token cru (útil em alguns clientes / testes)
      token = parts[0];
    }
  }

  if (!token) {
    return res.status(401).json({ erro: 'Token não fornecido.' });
  }

  try {
    const decoded = verificarToken(token);

    // Compat + campos úteis
    req.usuario = decoded;
    req.user = decoded;
    req.userId = decoded.id;
    req.role = normalizeRole(decoded.funcao_user_role || decoded.funcao || decoded.role);

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
  // Constrói lista final de roles permitidas, única e normalizada
  let allowed = [];
  for (const arg of funcoesPermitidas) {
    allowed = allowed.concat(toRoleList(arg));
  }
  // remove duplicatas e vazios
  allowed = Array.from(new Set(allowed)).filter(Boolean);

  return (req, res, next) => {
    // já normalizado no autenticarToken; fallback para campos brutos se necessário
    const roleAtual =
      req.role ||
      normalizeRole(
        req.usuario?.funcao_user_role ||
        req.user?.funcao_user_role ||
        req.usuario?.funcao ||
        req.user?.funcao ||
        req.usuario?.role ||
        req.user?.role
      );

    if (!roleAtual) {
      return res.status(403).json({ erro: 'Acesso negado. Permissão ausente.' });
    }

    if (!allowed.includes(roleAtual)) {
      return res.status(403).json({
        erro: 'Acesso negado. Permissão insuficiente.',
        roleAtual,
        permitido: allowed, // ex.: ["ADMIN","MASTER"]
      });
    }

    return next();
  };
};

export default { autenticarToken, autorizarRoles };

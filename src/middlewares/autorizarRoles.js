// src/middlewares/autorizarRoles.js
/**
 * Middleware de autorização por roles/papéis.
 *
 * Uso:
 *   import { autorizarRoles } from '../middlewares/autorizarRoles.js';
 *   router.post('/rota', autenticarToken, autorizarRoles('ADMIN','OPERADOR'), handler);
 *
 * O middleware assume que o middleware de autenticação já definiu req.usuario
 * (ou req.user) com o payload do token.
 */

function normalizarRole(raw) {
  if (!raw) return null;
  // remover acentos, transformar em maiúsculas e remover espaços extras
  return raw
    .toString()
    .normalize('NFD')                    // decompõe acentos
    .replace(/[\u0300-\u036f]/g, '')     // remove acentos
    .trim()
    .toUpperCase();
}

/**
 * autorizarRoles(...permittedRoles)
 *
 * @param  {...string} permittedRoles - Roles permitidos, ex: 'ADMIN', 'OPERADOR'
 * @returns middleware (req, res, next)
 */
export const autorizarRoles = (...permittedRoles) => {
  // Normaliza as roles permitidas uma vez
  const permitidasNormalizadas = permittedRoles
    .filter(Boolean)
    .map(r => normalizarRole(r));

  return (req, res, next) => {
    // Verifica se o usuário foi autenticado (middleware de auth deve rodar antes)
    const usuarioPayload = req.usuario || req.user;
    if (!usuarioPayload) {
      return res.status(401).json({ erro: 'Não autenticado. Token esperado.' });
    }

    // Tenta extrair role usando vários nomes possíveis
    const rawRole =
      usuarioPayload.funcao_user_role ||
      usuarioPayload.funcao ||
      usuarioPayload.role ||
      usuarioPayload.roles || // possibilidade de array
      usuarioPayload.role_name ||
      usuarioPayload.perfil;

    // Se for array, pega o primeiro (ou converta em string compatível)
    let userRole = rawRole;
    if (Array.isArray(rawRole)) {
      userRole = rawRole.length ? rawRole[0] : null;
    }

    const userRoleNorm = normalizarRole(userRole);

    if (!userRoleNorm) {
      return res.status(403).json({ erro: 'Acesso negado. Permissão insuficiente.' });
    }

    // Se nenhuma role permitida foi passada, negar por segurança
    if (!permitidasNormalizadas.length) {
      return res.status(403).json({ erro: 'Acesso negado. Configuração de roles inválida.' });
    }

    // Verifica se a role do usuário está na lista permitida
    if (!permitidasNormalizadas.includes(userRoleNorm)) {
      return res.status(403).json({ erro: 'Acesso negado. Permissão insuficiente.' });
    }

    // tudo ok
    next();
  };
};

/**
 * Export padrão (útil se você preferir importar sem as chaves)
 */
export default autorizarRoles;

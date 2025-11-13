// src/modules/publicSignup/publicSignup.service.js
import db from '../../models/db.js';

/**
 * Verifica se já existe usuário com esse e-mail.
 * Como seu schema não tem coluna "email", usamos "usuario" (que você usa como e-mail).
 */
export async function findUserByEmail(emailLc) {
  const r = await db.query(
    `SELECT 1
       FROM usuarios
      WHERE LOWER(usuario) = LOWER($1)
      LIMIT 1`,
    [emailLc]
  );
  return r.rowCount > 0;
}

/**
 * Cria usuário com senha_hash e funcao_user_role (colunas reais do seu schema).
 * Espera: { nome, usuario, senha }  (senha já vem hash do controller)
 */
export async function createUser({ nome, usuario, senha }) {
  const r = await db.query(
    `INSERT INTO usuarios (nome, usuario, senha_hash, funcao_user_role, ativo, criado_em)
     VALUES ($1, $2, $3, 'USER', true, NOW())
     RETURNING id, nome, usuario, funcao_user_role AS funcao, ativo`,
    [nome, usuario, senha]
  );
  return r.rows[0];
}

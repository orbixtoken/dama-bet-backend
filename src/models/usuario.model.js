import db from './db.js';

// Buscar usuário pelo campo 'usuario' (que pode ser número ou email)
export const buscarUsuarioPorUsuario = async (usuario) => {
  const query = 'SELECT * FROM usuarios WHERE usuario = $1 AND ativo = true';
  const values = [usuario];
  const result = await db.query(query, values);
  return result.rows[0]; // retorna o primeiro (e único) resultado
};

// Criar novo usuário
export const criarUsuario = async (nome, usuario, senhaCriptografada, funcao) => {
  const query = `
    INSERT INTO usuarios (nome, usuario, senha, funcao_user_role, ativo)
    VALUES ($1, $2, $3, $4, true)
    RETURNING id, nome, usuario, funcao_user_role
  `;
  const values = [nome, usuario, senhaCriptografada, funcao];
  const result = await db.query(query, values);
  return result.rows[0];
};

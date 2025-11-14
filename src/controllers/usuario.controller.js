// src/controllers/usuario.controller.js
import bcrypt from 'bcryptjs';
import db from '../models/db.js';

// ========================
// Função utilitária para validar CPF
// ========================
function validarCPF(cpf) {
  cpf = String(cpf || '').replace(/[^\d]+/g, '');

  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  let soma = 0;
  for (let i = 1; i <= 9; i++) soma += parseInt(cpf[i - 1], 10) * (11 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf[9], 10)) return false;

  soma = 0;
  for (let i = 1; i <= 10; i++) soma += parseInt(cpf[i - 1], 10) * (12 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;

  return resto === parseInt(cpf[10], 10);
}

// ========================
// CADASTRAR USUÁRIO
// ========================
export const cadastrarUsuario = async (req, res) => {
  try {
    let { nome, usuario, senha, funcao, cpf, telefone } = req.body || {};

    // Normalizações
    usuario = String(usuario || '').trim().toLowerCase();

    if (!nome || !usuario || !senha || !funcao || !cpf || !telefone) {
      return res.status(400).json({ erro: 'Todos os campos são obrigatórios.' });
    }

    if (!validarCPF(cpf)) {
      return res.status(400).json({ erro: 'CPF inválido.' });
    }

    // Verifica duplicidade de usuário ou CPF
    const existe = await db.query(
      'SELECT 1 FROM usuarios WHERE usuario = $1 OR cpf = $2 LIMIT 1',
      [usuario, cpf]
    );
    if (existe.rows.length > 0) {
      return res.status(409).json({ erro: 'Usuário ou CPF já cadastrado.' });
    }

    const senhaHash = await bcrypt.hash(String(senha), 10);

    await db.query(
      `INSERT INTO usuarios (nome, usuario, senha, funcao, ativo, cpf, telefone)
       VALUES ($1, $2, $3, $4, true, $5, $6)`,
      [nome, usuario, senhaHash, funcao, cpf, telefone]
    );

    return res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso.' });
  } catch (error) {
    console.error('Erro ao cadastrar usuário:', error);
    return res.status(500).json({ erro: 'Erro interno ao cadastrar usuário.' });
  }
};

// ========================
// PERFIL DO USUÁRIO LOGADO
// ========================
export const getMeuPerfil = async (req, res) => {
  try {
    const userId = req.usuario?.id || req.user?.id;
    if (!userId) return res.status(401).json({ erro: 'Não autenticado.' });

    const result = await db.query(
      `SELECT id, nome, usuario, funcao, cpf, telefone, criado_em
         FROM usuarios
        WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    return res.status(500).json({ erro: 'Erro interno ao buscar perfil.' });
  }
};

// ========================
// ATUALIZAR PERFIL (pelo próprio usuário)
// ========================
export const atualizarPerfil = async (req, res) => {
  try {
    const userId = req.usuario?.id || req.user?.id;
    if (!userId) return res.status(401).json({ erro: 'Não autenticado.' });

    const { nome, telefone } = req.body || {};
    if (!nome && !telefone) {
      return res.status(400).json({ erro: 'Informe ao menos um campo para atualizar.' });
    }

    await db.query(
      `UPDATE usuarios
          SET nome = COALESCE($1, nome),
              telefone = COALESCE($2, telefone)
        WHERE id = $3`,
      [nome ?? null, telefone ?? null, userId]
    );

    return res.json({ mensagem: 'Perfil atualizado com sucesso.' });
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    return res.status(500).json({ erro: 'Erro interno ao atualizar perfil.' });
  }
};

// ========================
// ALTERAR SENHA (usuário)
// ========================
export const alterarSenha = async (req, res) => {
  try {
    const userId = req.usuario?.id || req.user?.id;
    if (!userId) return res.status(401).json({ erro: 'Não autenticado.' });

    const { senhaAtual, novaSenha } = req.body || {};
    if (!senhaAtual || !novaSenha) {
      return res
        .status(400)
        .json({ erro: 'Senha atual e nova senha são obrigatórias.' });
    }

    const result = await db.query('SELECT senha FROM usuarios WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const senhaValida = await bcrypt.compare(String(senhaAtual), result.rows[0].senha);
    if (!senhaValida) {
      return res.status(401).json({ erro: 'Senha atual incorreta.' });
    }

    const senhaHash = await bcrypt.hash(String(novaSenha), 10);
    await db.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [senhaHash, userId]);

    return res.json({ mensagem: 'Senha alterada com sucesso.' });
  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    return res.status(500).json({ erro: 'Erro interno ao alterar senha.' });
  }
};

// ========================
// RESETAR SENHA (ADMIN)
// ========================
export const resetarSenha = async (req, res) => {
  try {
    const { usuario, novaSenha } = req.body || {};
    const usuarioNorm = String(usuario || '').trim().toLowerCase();

    if (!usuarioNorm || !novaSenha) {
      return res.status(400).json({ erro: 'Usuário e nova senha são obrigatórios.' });
    }

    const senhaHash = await bcrypt.hash(String(novaSenha), 10);
    const result = await db.query(
      `UPDATE usuarios
          SET senha = $1
        WHERE usuario = $2
        RETURNING id`,
      [senhaHash, usuarioNorm]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    return res.json({ mensagem: 'Senha redefinida com sucesso.' });
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    return res.status(500).json({ erro: 'Erro interno ao redefinir senha.' });
  }
};

// ========================
// VALIDAR CPF
// ========================
export const validarCpfEndpoint = async (req, res) => {
  try {
    const { cpf } = req.body || {};

    if (!cpf) {
      return res.status(400).json({ erro: 'CPF é obrigatório.' });
    }

    if (!validarCPF(cpf)) {
      return res.status(400).json({ valido: false, mensagem: 'CPF inválido.' });
    }

    const existe = await db.query(
      'SELECT 1 FROM usuarios WHERE cpf = $1 LIMIT 1',
      [cpf]
    );
    if (existe.rows.length > 0) {
      return res
        .status(409)
        .json({ valido: false, mensagem: 'CPF já cadastrado.' });
    }

    return res.json({ valido: true, mensagem: 'CPF válido e disponível.' });
  } catch (error) {
    console.error('Erro ao validar CPF:', error);
    return res.status(500).json({ erro: 'Erro interno ao validar CPF.' });
  }
};

// ========================
// ATUALIZAR USUÁRIO (ADMIN/GERENTE)
// ========================
export const atualizarUsuario = async (req, res) => {
  try {
    const { id } = req.params || {};
    const { nome, telefone } = req.body || {};

    if (!id) return res.status(400).json({ erro: 'ID do usuário é obrigatório.' });
    if (!nome && !telefone) {
      return res.status(400).json({ erro: 'Informe ao menos um campo para atualizar.' });
    }

    const existe = await db.query('SELECT 1 FROM usuarios WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    await db.query(
      `UPDATE usuarios
          SET nome = COALESCE($1, nome),
              telefone = COALESCE($2, telefone)
        WHERE id = $3`,
      [nome ?? null, telefone ?? null, id]
    );

    return res.json({ mensagem: 'Usuário atualizado com sucesso.' });
  } catch (error) {
    console.error('Erro ao atualizar usuário (admin):', error);
    return res.status(500).json({ erro: 'Erro interno ao atualizar usuário.' });
  }
};

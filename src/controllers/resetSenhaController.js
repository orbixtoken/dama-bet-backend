// src/controllers/resetSenhaController.js
import db from '../models/db.js';
import bcrypt from 'bcryptjs';

/**
 * PUT /api/reset-senha
 * Requer: Authorization: Bearer <accessToken>
 * Body: { novaSenha: string }
 *
 * - Atualiza a senha do usuário autenticado (req.usuario.id).
 * - Revoga todos os refresh tokens do usuário (logout global).
 */
export const atualizarSenha = async (req, res) => {
  try {
    const userId = req.usuario?.id; // setado pelo autenticarToken
    const { novaSenha } = req.body;

    if (!userId) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }

    if (!novaSenha || typeof novaSenha !== 'string' || novaSenha.length < 6) {
      return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 6 caracteres.' });
    }

    // (Opcional) verificação de complexidade simples
    // if (!/[A-Za-z]/.test(novaSenha) || !/\d/.test(novaSenha)) {
    //   return res.status(400).json({ erro: 'A nova senha deve ter letras e números.' });
    // }

    const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
    const senhaHash = await bcrypt.hash(novaSenha, saltRounds);

    await db.query('BEGIN');

    // Atualiza a senha
    const { rows, rowCount } = await db.query(
      `UPDATE usuarios
          SET senha = $1, atualizado_em = NOW()
        WHERE id = $2
      RETURNING id, usuario, funcao`,
      [senhaHash, userId]
    );

    if (rowCount === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    // Revoga todos os refresh tokens do usuário (logout global)
    await db.query(
      `UPDATE refresh_tokens
          SET revoked = true
        WHERE user_id = $1 AND revoked = false`,
      [userId]
    );

    await db.query('COMMIT');

    return res.status(200).json({
      mensagem: 'Senha redefinida com sucesso. Todas as sessões foram encerradas.',
      usuario: {
        id: rows[0].id,
        usuario: rows[0].usuario,
        funcao: rows[0].funcao,
      },
    });
  } catch (erro) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erro ao atualizar senha:', erro);
    return res.status(500).json({ erro: 'Erro interno ao redefinir senha.' });
  }
};

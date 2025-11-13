// src/modules/publicSignup/publicSignup.controller.js
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { findUserByEmail, createUser } from './publicSignup.service.js';
import { issueTokensForUser } from '../../utils/token.util.js'; // ou tokenUtils.js conforme seu projeto

const signupSchema = z.object({
  nome: z.string().min(2).max(120),
  email: z.string().email(),
  senha: z.string().min(6).max(100),
});

export async function signup(req, res, next) {
  try {
    if (process.env.PUBLIC_SIGNUP_ENABLED !== 'true') {
      return res.status(404).json({ erro: 'Rota não disponível.' });
    }

    const { nome, email, senha } = signupSchema.parse(req.body);
    const emailLc = String(email).trim().toLowerCase();

    // (opcional) whitelist de domínios
    const allowed = (process.env.ALLOWED_SIGNUP_DOMAINS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length) {
      const dom = emailLc.split('@')[1] || '';
      if (!allowed.includes(dom)) {
        return res.status(403).json({ erro: 'E-mail não permitido para cadastro.' });
      }
    }

    // já existe?
    const exists = await findUserByEmail(emailLc);
    if (exists) return res.status(409).json({ erro: 'E-mail já cadastrado.' });

    // hash
    const senhaHash = await bcrypt.hash(senha, 10);

    // cria (usuario = email)
    const novo = await createUser({
      nome,
      usuario: emailLc,
      senha: senhaHash, // grava em senha_hash (service faz o mapeamento)
    });

    // tokens igual login
    const { accessToken, refreshToken } = await issueTokensForUser(novo);

    return res.status(201).json({
      mensagem: 'Conta criada com sucesso.',
      accessToken,
      refreshToken,
      usuario: {
        id: novo.id,
        nome: novo.nome,
        email: emailLc,
        funcao: novo.funcao,
      },
    });
  } catch (err) {
    if (err?.issues) {
      return res.status(400).json({ erro: 'Dados inválidos.', detalhes: err.issues });
    }
    return next(err);
  }
}

export async function checkEmail(req, res, next) {
  try {
    if (process.env.PUBLIC_SIGNUP_ENABLED !== 'true') {
      return res.status(404).json({ erro: 'Rota não disponível.' });
    }
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ erro: 'Parâmetro email é obrigatório.' });

    const exists = await findUserByEmail(email);
    return res.json({ available: !exists });
  } catch (err) {
    return next(err);
  }
}

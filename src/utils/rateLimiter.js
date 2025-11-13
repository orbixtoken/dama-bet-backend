// src/utils/rateLimiter.js
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// 🔐 Limite de tentativas de login (5 por 15 min)
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator, // <= importante para IPv6
  message: { erro: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

// 🔐 Limite de reset de senha (3 por hora)
export const resetSenhaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator, // <= importante para IPv6
  message: { erro: 'Muitas tentativas de reset de senha. Tente novamente mais tarde.' },
});

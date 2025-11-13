// src/modules/publicSignup/publicSignup.routes.js
import { Router } from 'express';
import { signup, checkEmail } from './publicSignup.controller.js';

const router = Router();

/**
 * POST /api/public/signup
 * Auto-cadastro de usuário (público)
 */
router.post('/signup', signup);

/**
 * GET /api/public/check-email?email=...
 * Retorna { available: boolean } indicando se e-mail está livre
 */
router.get('/check-email', checkEmail);

export default router;

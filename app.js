// app.js (raiz do projeto)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';

// Rotas existentes
import authRoutes from './src/routes/auth.routes.js';
import usuarioRoutes from './src/routes/usuario.routes.js';
import dashboardRoutes from './src/routes/dashboard.routes.js';
import financeiroRoutes from './src/routes/financeiro.routes.js';
import apostaRoutes from './src/routes/aposta.routes.js';
import jogoRoutes from './src/routes/jogo.routes.js';
import resultadoRoutes from './src/routes/resultado.routes.js';
import transacoesExternasRoutes from './src/routes/transacoes_externas.routes.js';
import resetSenhaRoutes from './src/routes/resetSenha.routes.js';
import saldoRoutes from './src/routes/saldo.routes.js';
import saqueRoutes from './src/routes/saque.routes.js';
import adminRoutes from './src/routes/admin.routes.js';
import pfSeedsRoutes from './src/routes/pfseeds.routes.js';
import cassinoRoutes from './src/routes/cassino.routes.js';
import cassinoConfigRoutes from './src/routes/cassino.config.routes.js';
import pspRoutes from './src/routes/psp.routes.js';

// ATENÇÃO: este router deve declarar caminhos relativos ("/me", "/history", "/claim-weekly")
import referralRoutes from './src/routes/referral.routes.js';

import publicSignupRoutes from './src/modules/publicSignup/publicSignup.routes.js';
import depositosRoutes from './src/routes/depositos.routes.js';
import financeiroAdminRoutes from './src/routes/financeiroAdmin.routes.js';

// Rate limiters
import { rlAuth, rlMoney, rlGames } from './src/middlewares/rateLimit.middleware.js';

// Swagger
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './src/docs/swagger.js';

// Middlewares de erro
import { errorConverter, errorHandler } from './src/middlewares/error.middleware.js';

// (Opcional) logs
// import morgan from 'morgan';

dotenv.config();

const app = express();

// trust proxy (quando atrás de NGINX/Render/Heroku)
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

/* ============================================================
 * CORS — libera localhost 5173/5174 + allowlist por ENV
 * ============================================================ */
const allowlist = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DEV_ORIGINS = [
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const effectiveAllowlist = allowlist.length
  ? [...allowlist, ...DEV_ORIGINS]
  : [...DEV_ORIGINS];

const isAllowed = (origin) =>
  !origin || // sem Origin → permite (Postman, curl)
  effectiveAllowlist.includes('*') ||
  effectiveAllowlist.includes(origin);

const corsOptions = {
  origin(origin, callback) {
    if (isAllowed(origin)) return callback(null, true);
    console.warn(`❌ Bloqueado por CORS: ${origin}`);
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
};

// Middlewares globais
app.use(helmet());
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // responde preflight
app.use(express.json({ limit: '10mb' }));
// if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

/* ============================================================
 * HEALTHCHECK & SWAGGER
 * ============================================================ */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

if (process.env.SWAGGER_ENABLED !== 'false') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

/* ============================================================
 * RATE LIMITS (apenas uma vez, ANTES das rotas-alvo)
 * ============================================================ */
app.use('/api/auth', rlAuth);        // login/refresh/reset
app.use('/api/financeiro', rlMoney); // depósitos/saques
app.use('/api/cassino', rlGames);    // endpoints de jogos
app.use('/api/public', rlAuth);      // público (signup/check-email)

/* ============================================================
 * ROTAS
 * ============================================================ */
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/financeiro', financeiroRoutes);
app.use('/api/apostas', apostaRoutes);
app.use('/api/jogos', jogoRoutes);
app.use('/api/resultados', resultadoRoutes);
app.use('/api/transacoes-externas', transacoesExternasRoutes);
app.use('/api/reset-senha', resetSenhaRoutes);
app.use('/api/saldo', saldoRoutes);
app.use('/api/saques', saqueRoutes);

// Aqui o prefixo é /api/referrals.
// Portanto, dentro do arquivo referral.routes.js os paths devem ser:
// GET "/me", GET "/history", POST "/claim-weekly"
app.use('/api/referrals', referralRoutes);

app.use('/api/pf-seeds', pfSeedsRoutes);
app.use('/api/cassino', cassinoRoutes);
app.use('/api/cassino', cassinoConfigRoutes);
app.use('/api', pspRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', depositosRoutes);
app.use('/api/admin/financeiro', financeiroAdminRoutes);

// NOVO namespace público (auto-cadastro)
app.use('/api/public', publicSignupRoutes);

/* ============================================================
 * 404 & ERROS GLOBAIS
 * ============================================================ */
app.use((req, res) => {
  res.status(404).json({
    erro: `Rota não encontrada: ${req.method} ${req.originalUrl}`,
  });
});

app.use(errorConverter);
app.use(errorHandler);

export default app;

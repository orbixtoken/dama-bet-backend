// src/models/db.js
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const {
  NODE_ENV,
  DATABASE_URL,
  DB_HOST = 'localhost',
  DB_PORT = '5432',
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  DB_SSL = 'false',
  DB_POOL_MAX = '10',
  DB_IDLE_TIMEOUT_MS = '30000',
  DB_CONN_TIMEOUT_MS = '5000',
} = process.env;

// Se DB_SSL=true nas envs, força SSL
const useSSL = String(DB_SSL).toLowerCase() === 'true';

// Heurística: se a URL tem sslmode=require (Neon/Heroku) ou domínio neon.tech, força SSL
const neonWantsSSL =
  (DATABASE_URL && /sslmode=require/i.test(DATABASE_URL)) ||
  (DATABASE_URL && /neon\.tech/i.test(DATABASE_URL));

/**
 * Permite usar:
 *  - DATABASE_URL (Render/Heroku/Neon)
 *  - OU variáveis soltas (DB_HOST/DB_USER/DB_PASSWORD/DB_NAME)
 */
const baseConfig = DATABASE_URL
  ? {
      connectionString: DATABASE_URL,
      ssl: (useSSL || neonWantsSSL) ? { rejectUnauthorized: false } : false,
    }
  : {
      host: DB_HOST,
      port: parseInt(DB_PORT, 10),
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool({
  ...baseConfig,
  max: parseInt(DB_POOL_MAX, 10),
  idleTimeoutMillis: parseInt(DB_IDLE_TIMEOUT_MS, 10),
  connectionTimeoutMillis: parseInt(DB_CONN_TIMEOUT_MS, 10),
  application_name: 'dama-bet-backend',
});

/* ------------------------------------------------------------------ */
/* Logs resumidos (evita vazar credenciais)                            */
/* ------------------------------------------------------------------ */
pool.on('connect', async () => {
  if (NODE_ENV !== 'production') {
    console.log('✅ Pool PostgreSQL ativo.');
    try {
      const r = await pool.query('select current_database() as db, now() as now');
      console.log(`📦 Conectado ao banco: ${r.rows[0].db} @ ${r.rows[0].now}`);
    } catch (e) {
      console.log('ℹ️ Conectou, mas o SELECT de verificação falhou:', e.message);
    }
  }
});

pool.on('error', (err) => {
  console.error('❌ Erro no pool do PostgreSQL:', err);
});

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */
const db = {
  pool,
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect(),
};

export default db;

export const query = (text, params) => pool.query(text, params);

/** Helper para transações: passa um client já dentro de BEGIN */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
  if (NODE_ENV !== 'production') {
    console.log('👋 Pool do PostgreSQL encerrado.');
  }
}

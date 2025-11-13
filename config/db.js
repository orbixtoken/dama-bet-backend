// src/config/db.js
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

// Verificação simples de conexão
pool.query('SELECT NOW()')
  .then(() => console.log('🟢 Conectado ao PostgreSQL com sucesso!'))
  .catch(err => console.error('🔴 Erro ao conectar ao PostgreSQL:', err));

export default pool;

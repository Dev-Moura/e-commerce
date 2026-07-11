import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/payments_db',
});

export async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

export async function initDB() {
  try {
    // Testar conexão
    await pool.query('SELECT NOW()');
    console.log('🐘 Conectado ao PostgreSQL com sucesso!');

    // Criar tabela de idempotency_keys
    await pool.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) NOT NULL,
        response_body TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('📋 Tabela idempotency_keys verificada/criada.');

    // Criar tabela de payments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(255) UNIQUE NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        status VARCHAR(50) NOT NULL,
        transaction_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('📋 Tabela payments verificada/criada.');
  } catch (error) {
    console.error('❌ Erro ao inicializar o PostgreSQL:', error);
    throw error;
  }
}

export default pool;

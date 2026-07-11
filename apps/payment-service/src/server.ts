import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDB, query } from './db.js';
import { connectRabbitMQ } from './rabbitmq.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3003;

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Payment Service' });
});

// Listar todos os pagamentos realizados
app.get('/payments', async (req, res) => {
  try {
    const result = await query('SELECT * FROM payments ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao buscar pagamentos', details: error.message });
  }
});

// Obter pagamento por ID de Pedido
app.get('/payments/:orderId', async (req, res: any) => {
  try {
    const { orderId } = req.params;
    const result = await query('SELECT * FROM payments WHERE order_id = $1', [orderId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pagamento não encontrado para este pedido' });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao buscar pagamento', details: error.message });
  }
});

// Inicialização do Banco de Dados PostgreSQL e do RabbitMQ
async function startServer() {
  try {
    // 1. Inicializa o banco de dados
    await initDB();

    // 2. Conecta ao RabbitMQ para consumir mensagens de order.created
    await connectRabbitMQ();

    // 3. Inicia o servidor HTTP
    app.listen(PORT, () => {
      console.log(`🚀 Payment Service rodando na porta ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Falha crítica ao iniciar o Payment Service:', error);
    process.exit(1);
  }
}

startServer();

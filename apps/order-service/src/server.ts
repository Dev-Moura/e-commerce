import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import Order from './models/Order.js';
import { connectRabbitMQ, publishEvent } from './rabbitmq.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const MONGO_URI = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/orders';
const PORT = process.env.PORT || 3002;

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Order Service' });
});

// Criar Pedido
app.post('/orders', async (req, res: any) => {
  try {
    const { userId, items } = req.body;

    if (!userId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'userId e items (array) são obrigatórios' });
    }

    // Calcula o valor total do pedido
    const totalAmount = items.reduce((sum: number, item: any) => {
      return sum + (item.price * item.quantity);
    }, 0);

    const order = new Order({
      userId,
      items,
      totalAmount,
      status: 'PENDING'
    });

    await order.save();

    // Publica o evento de pedido criado no RabbitMQ
    // O Payment Service vai consumir este evento para processar o pagamento
    publishEvent('order.created', {
      orderId: order._id,
      userId: order.userId,
      totalAmount: order.totalAmount,
      items: order.items
    });

    res.status(201).json(order);
  } catch (error) {
    console.error('Erro ao criar pedido:', error);
    res.status(500).json({ error: 'Erro interno ao processar pedido' });
  }
});

// Listar Pedidos (opcionalmente filtrando por userId)
app.get('/orders', async (req, res) => {
  try {
    const { userId } = req.query;
    const filter = userId ? { userId: userId as string } : {};
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar pedidos' });
  }
});

// Obter Pedido por ID
app.get('/orders/:id', async (req, res: any) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar detalhes do pedido' });
  }
});

// Conectar ao Banco de Dados, RabbitMQ e iniciar servidor
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('📦 Order Service conectado ao MongoDB!');
    await connectRabbitMQ();
    app.listen(PORT, () => {
      console.log(`🚀 Order Service rodando na porta ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('❌ Erro de conexão no MongoDB do Order Service:', error);
  });

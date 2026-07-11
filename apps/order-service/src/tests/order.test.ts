import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('mongoose', () => ({
  default: { connect: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../models/Order.js', () => ({
  default: {
    find: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../rabbitmq.js', () => ({
  connectRabbitMQ: vi.fn().mockResolvedValue(undefined),
  publishEvent: vi.fn(),
}));

import Order from '../models/Order.js';
import { publishEvent } from '../rabbitmq.js';

// ─── App de teste isolado ─────────────────────────────────────────────────────
function createTestApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', service: 'Order Service' });
  });

  // Criar pedido
  app.post('/orders', async (req: any, res: any) => {
    try {
      const { userId, items } = req.body;
      if (!userId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'userId e items (array) são obrigatórios' });
      }

      const totalAmount = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
      const order = { _id: 'order-123', userId, items, totalAmount, status: 'PENDING' };

      await (publishEvent as any)('order.created', {
        orderId: order._id,
        userId: order.userId,
        totalAmount: order.totalAmount,
        items: order.items,
      });

      return res.status(201).json(order);
    } catch {
      return res.status(500).json({ error: 'Erro interno ao processar pedido' });
    }
  });

  // Listar pedidos
  app.get('/orders', async (req: any, res: any) => {
    try {
      const { userId } = req.query;
      const filter = userId ? { userId } : {};
      const orders = await (Order as any).find(filter);
      return res.json(orders);
    } catch {
      return res.status(500).json({ error: 'Erro ao buscar pedidos' });
    }
  });

  // Buscar pedido por ID
  app.get('/orders/:id', async (req: any, res: any) => {
    try {
      const order = await (Order as any).findById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
      return res.json(order);
    } catch {
      return res.status(500).json({ error: 'Erro ao buscar detalhes do pedido' });
    }
  });

  return app;
}

// ─── Testes ───────────────────────────────────────────────────────────────────
describe('Order Service', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // ── Healthcheck ────────────────────────────────────────────────────────────
  describe('GET /health', () => {
    it('deve retornar status OK', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'OK', service: 'Order Service' });
    });
  });

  // ── Criação de pedido ──────────────────────────────────────────────────────
  describe('POST /orders', () => {
    const validOrder = {
      userId: 'user-123',
      items: [
        { productId: 'prod-1', name: 'Tênis Nike', price: 299.99, quantity: 2 },
        { productId: 'prod-2', name: 'Meia', price: 19.99, quantity: 3 },
      ],
    };

    it('deve criar pedido e calcular total corretamente', async () => {
      const res = await request(app).post('/orders').send(validOrder);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      // total = (299.99 * 2) + (19.99 * 3) = 599.98 + 59.97 = 659.95
      expect(res.body.totalAmount).toBeCloseTo(659.95, 2);
      expect(res.body.userId).toBe('user-123');
    });

    it('deve publicar evento order.created no RabbitMQ', async () => {
      await request(app).post('/orders').send(validOrder);

      expect(publishEvent).toHaveBeenCalledWith('order.created', expect.objectContaining({
        orderId: 'order-123',
        userId: 'user-123',
        totalAmount: expect.any(Number),
      }));
    });

    it('deve rejeitar pedido sem userId', async () => {
      const res = await request(app).post('/orders').send({ items: validOrder.items });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('obrigatórios');
    });

    it('deve rejeitar pedido com items vazio', async () => {
      const res = await request(app).post('/orders').send({ userId: 'user-123', items: [] });
      expect(res.status).toBe(400);
    });

    it('deve rejeitar pedido sem items', async () => {
      const res = await request(app).post('/orders').send({ userId: 'user-123' });
      expect(res.status).toBe(400);
    });

    it('deve calcular total com item único corretamente', async () => {
      const res = await request(app).post('/orders').send({
        userId: 'user-abc',
        items: [{ productId: 'prod-x', name: 'Produto X', price: 100, quantity: 3 }],
      });
      expect(res.status).toBe(201);
      expect(res.body.totalAmount).toBe(300);
    });
  });

  // ── Listagem de pedidos ────────────────────────────────────────────────────
  describe('GET /orders', () => {
    it('deve listar todos os pedidos', async () => {
      const mockOrders = [
        { _id: 'order-1', userId: 'user-1', totalAmount: 100, status: 'PENDING' },
        { _id: 'order-2', userId: 'user-2', totalAmount: 250, status: 'APPROVED' },
      ];
      (Order.find as any).mockResolvedValue(mockOrders);

      const res = await request(app).get('/orders');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('deve filtrar pedidos por userId', async () => {
      const mockOrders = [{ _id: 'order-1', userId: 'user-1', totalAmount: 100 }];
      (Order.find as any).mockResolvedValue(mockOrders);

      const res = await request(app).get('/orders?userId=user-1');
      expect(res.status).toBe(200);
      expect(Order.find).toHaveBeenCalledWith({ userId: 'user-1' });
    });
  });

  // ── Buscar pedido por ID ───────────────────────────────────────────────────
  describe('GET /orders/:id', () => {
    it('deve retornar pedido pelo ID', async () => {
      const mockOrder = { _id: 'order-123', userId: 'user-1', totalAmount: 300, status: 'PENDING' };
      (Order.findById as any).mockResolvedValue(mockOrder);

      const res = await request(app).get('/orders/order-123');
      expect(res.status).toBe(200);
      expect(res.body._id).toBe('order-123');
    });

    it('deve retornar 404 para pedido inexistente', async () => {
      (Order.findById as any).mockResolvedValue(null);
      const res = await request(app).get('/orders/inexistente');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Pedido não encontrado');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../db.js', () => ({
  query: vi.fn(),
  initDB: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../rabbitmq.js', () => ({
  connectRabbitMQ: vi.fn().mockResolvedValue(undefined),
  publishEvent: vi.fn(),
}));

import { query } from '../db.js';

// ─── App de teste isolado ─────────────────────────────────────────────────────
function createTestApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', service: 'Payment Service' });
  });

  // Listar pagamentos
  app.get('/payments', async (_req, res: any) => {
    try {
      const result = await (query as any)('SELECT * FROM payments ORDER BY created_at DESC');
      return res.json(result.rows);
    } catch (error: any) {
      return res.status(500).json({ error: 'Erro ao buscar pagamentos', details: error.message });
    }
  });

  // Buscar pagamento por orderId
  app.get('/payments/:orderId', async (req: any, res: any) => {
    try {
      const result = await (query as any)(
        'SELECT * FROM payments WHERE order_id = $1',
        [req.params.orderId]
      );
      if (result.rows.length === 0)
        return res.status(404).json({ error: 'Pagamento não encontrado para este pedido' });
      return res.json(result.rows[0]);
    } catch (error: any) {
      return res.status(500).json({ error: 'Erro ao buscar pagamento', details: error.message });
    }
  });

  return app;
}

// ─── Testes ───────────────────────────────────────────────────────────────────
describe('Payment Service', () => {
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
      expect(res.body).toEqual({ status: 'OK', service: 'Payment Service' });
    });
  });

  // ── Listagem de pagamentos ─────────────────────────────────────────────────
  describe('GET /payments', () => {
    it('deve listar todos os pagamentos', async () => {
      const mockPayments = [
        { id: 1, order_id: 'order-1', amount: 299.99, status: 'APPROVED', transaction_id: 'txn_abc123' },
        { id: 2, order_id: 'order-2', amount: 5001, status: 'DECLINED', transaction_id: null },
      ];
      (query as any).mockResolvedValue({ rows: mockPayments });

      const res = await request(app).get('/payments');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].status).toBe('APPROVED');
      expect(res.body[1].status).toBe('DECLINED');
    });

    it('deve retornar lista vazia quando não há pagamentos', async () => {
      (query as any).mockResolvedValue({ rows: [] });
      const res = await request(app).get('/payments');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('deve retornar 500 em caso de falha no banco', async () => {
      (query as any).mockRejectedValue(new Error('DB connection lost'));
      const res = await request(app).get('/payments');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Erro ao buscar pagamentos');
    });
  });

  // ── Buscar por orderId ─────────────────────────────────────────────────────
  describe('GET /payments/:orderId', () => {
    it('deve retornar pagamento pelo orderId', async () => {
      const mockPayment = {
        id: 1,
        order_id: 'order-123',
        amount: 299.99,
        status: 'APPROVED',
        transaction_id: 'txn_xyz789',
      };
      (query as any).mockResolvedValue({ rows: [mockPayment] });

      const res = await request(app).get('/payments/order-123');

      expect(res.status).toBe(200);
      expect(res.body.order_id).toBe('order-123');
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.transaction_id).toBe('txn_xyz789');
    });

    it('deve retornar 404 para pagamento não encontrado', async () => {
      (query as any).mockResolvedValue({ rows: [] });
      const res = await request(app).get('/payments/order-inexistente');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Pagamento não encontrado para este pedido');
    });

    it('deve passar orderId corretamente para a query', async () => {
      (query as any).mockResolvedValue({ rows: [{ id: 1, order_id: 'order-abc' }] });
      await request(app).get('/payments/order-abc');
      expect(query).toHaveBeenCalledWith(
        'SELECT * FROM payments WHERE order_id = $1',
        ['order-abc']
      );
    });
  });
});

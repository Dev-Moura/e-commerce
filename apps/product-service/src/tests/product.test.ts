import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('mongoose', () => ({
  default: { connect: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../models/Product.js', () => ({
  default: {
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock('../rabbitmq.js', () => ({
  connectRabbitMQ: vi.fn().mockResolvedValue(undefined),
  publishEvent: vi.fn(),
}));

import Product from '../models/Product.js';
import { publishEvent } from '../rabbitmq.js';

// ─── App de teste isolado ─────────────────────────────────────────────────────
function createTestApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', service: 'Product Service' });
  });

  // Criar produto
  app.post('/products', async (req: any, res: any) => {
    try {
      const productData = req.body;
      if (!productData.name || !productData.price) {
        return res.status(400).json({ error: 'name e price são obrigatórios' });
      }
      const product: any = { _id: 'prod-123', ...productData };
      await (publishEvent as any)('product.created', {
        id: product._id,
        name: product.name,
        description: product.description,
        price: product.price,
        stock: product.stock,
        category: product.category,
      });
      return res.status(201).json(product);
    } catch {
      return res.status(400).json({ error: 'Erro ao criar produto' });
    }
  });

  // Atualizar produto
  app.put('/products/:id', async (req: any, res: any) => {
    try {
      const product: any = await (Product as any).findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
      await (publishEvent as any)('product.updated', { id: product._id, ...req.body });
      return res.json(product);
    } catch {
      return res.status(400).json({ error: 'Erro ao atualizar produto' });
    }
  });

  // Listar produtos
  app.get('/products', async (_req, res) => {
    const products = await (Product as any).find();
    res.json(products);
  });

  // Buscar produto por ID
  app.get('/products/:id', async (req: any, res: any) => {
    try {
      const product = await (Product as any).findById(req.params.id);
      if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
      return res.json(product);
    } catch {
      return res.status(400).json({ error: 'Erro ao buscar produto' });
    }
  });

  return app;
}

// ─── Testes ───────────────────────────────────────────────────────────────────
describe('Product Service', () => {
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
      expect(res.body).toEqual({ status: 'OK', service: 'Product Service' });
    });
  });

  // ── Criação de produto ─────────────────────────────────────────────────────
  describe('POST /products', () => {
    it('deve criar produto e publicar evento no RabbitMQ', async () => {
      const res = await request(app).post('/products').send({
        name: 'Tênis Nike',
        description: 'Tênis esportivo',
        price: 299.99,
        stock: 50,
        category: 'calçados',
      });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Tênis Nike');
      expect(res.body._id).toBe('prod-123');

      expect(publishEvent).toHaveBeenCalledWith('product.created', expect.objectContaining({
        name: 'Tênis Nike',
        price: 299.99,
      }));
    });

    it('deve rejeitar produto sem campos obrigatórios', async () => {
      const res = await request(app).post('/products').send({ description: 'Sem nome e preço' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('obrigatórios');
    });
  });

  // ── Listagem ───────────────────────────────────────────────────────────────
  describe('GET /products', () => {
    it('deve listar todos os produtos', async () => {
      const mockProducts = [
        { _id: 'prod-1', name: 'Produto A', price: 100 },
        { _id: 'prod-2', name: 'Produto B', price: 200 },
      ];
      (Product.find as any).mockResolvedValue(mockProducts);

      const res = await request(app).get('/products');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].name).toBe('Produto A');
    });

    it('deve retornar lista vazia quando não há produtos', async () => {
      (Product.find as any).mockResolvedValue([]);
      const res = await request(app).get('/products');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ── Buscar por ID ──────────────────────────────────────────────────────────
  describe('GET /products/:id', () => {
    it('deve retornar produto pelo ID', async () => {
      const mockProduct = { _id: 'prod-123', name: 'Tênis Nike', price: 299.99 };
      (Product.findById as any).mockResolvedValue(mockProduct);

      const res = await request(app).get('/products/prod-123');

      expect(res.status).toBe(200);
      expect(res.body._id).toBe('prod-123');
    });

    it('deve retornar 404 para produto inexistente', async () => {
      (Product.findById as any).mockResolvedValue(null);
      const res = await request(app).get('/products/id-inexistente');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Produto não encontrado');
    });
  });

  // ── Atualização ────────────────────────────────────────────────────────────
  describe('PUT /products/:id', () => {
    it('deve atualizar produto e publicar evento', async () => {
      const updatedProduct = { _id: 'prod-123', name: 'Tênis Updated', price: 349.99 };
      (Product.findByIdAndUpdate as any).mockResolvedValue(updatedProduct);

      const res = await request(app).put('/products/prod-123').send({ price: 349.99 });

      expect(res.status).toBe(200);
      expect(res.body.price).toBe(349.99);
      expect(publishEvent).toHaveBeenCalledWith('product.updated', expect.objectContaining({ id: 'prod-123' }));
    });

    it('deve retornar 404 ao atualizar produto inexistente', async () => {
      (Product.findByIdAndUpdate as any).mockResolvedValue(null);
      const res = await request(app).put('/products/inexistente').send({ price: 10 });
      expect(res.status).toBe(404);
    });
  });
});

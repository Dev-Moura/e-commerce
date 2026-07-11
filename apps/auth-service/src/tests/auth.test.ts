import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('mongoose', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(undefined),
    Schema: class {
      pre() { return this; }
      methods = {};
    },
    model: vi.fn(),
  },
}));

vi.mock('../models/User.js', () => {
  const mockUser = {
    _id: 'user-123',
    name: 'João Silva',
    email: 'joao@teste.com',
    passwordHash: 'hashed_password',
    comparePassword: vi.fn(),
    save: vi.fn(),
    select: vi.fn(),
  };

  return {
    default: {
      findOne: vi.fn(),
      findById: vi.fn(),
    },
    mockUser,
  };
});

// ─── Importações após mock ────────────────────────────────────────────────────
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_SECRET = 'super_secret_key_123';
const JWT_REFRESH_SECRET = 'super_refresh_secret_key_456';

// ─── App de teste isolado ─────────────────────────────────────────────────────
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Healthcheck
  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', service: 'Auth Service' });
  });

  // Middleware de autenticação
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: 'Token inválido ou expirado' });
      req.user = user;
      next();
    });
  };

  // Registro
  app.post('/auth/register', async (req: any, res: any) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Campos name, email e password são obrigatórios' });

    const existing = await (User as any).findOne({ email });
    if (existing) return res.status(400).json({ error: 'E-mail já cadastrado' });

    const user: any = { _id: 'user-new', name, email, save: vi.fn() };
    await user.save();
    return res.status(201).json({ id: user._id, name: user.name, email: user.email });
  });

  // Login
  app.post('/auth/login', async (req: any, res: any) => {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });

    const user: any = await (User as any).findOne({ email });
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ error: 'Credenciais inválidas' });

    const accessToken = jwt.sign({ id: user._id, email, name: user.name }, JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ id: user._id }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return res.json({ accessToken, refreshToken, user: { id: user._id, name: user.name, email } });
  });

  // Refresh
  app.post('/auth/refresh', async (req: any, res: any) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token não fornecido' });

    jwt.verify(refreshToken, JWT_REFRESH_SECRET, async (err: any, payload: any) => {
      if (err) return res.status(403).json({ error: 'Refresh token inválido' });
      const user: any = await (User as any).findById(payload.id);
      if (!user) return res.status(403).json({ error: 'Usuário não encontrado' });
      const accessToken = jwt.sign({ id: user._id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '15m' });
      return res.json({ accessToken });
    });
  });

  // Me
  app.get('/auth/me', authenticateToken, async (req: any, res: any) => {
    const user: any = await (User as any).findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    return res.json({ id: user._id, name: user.name, email: user.email });
  });

  return app;
}

// ─── Testes ───────────────────────────────────────────────────────────────────
describe('Auth Service', () => {
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
      expect(res.body).toEqual({ status: 'OK', service: 'Auth Service' });
    });
  });

  // ── Registro ───────────────────────────────────────────────────────────────
  describe('POST /auth/register', () => {
    it('deve registrar um novo usuário com sucesso', async () => {
      (User.findOne as any).mockResolvedValue(null);

      const res = await request(app).post('/auth/register').send({
        name: 'João Silva',
        email: 'joao@teste.com',
        password: 'senha123',
      });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.email).toBe('joao@teste.com');
    });

    it('deve rejeitar registro com campos faltando', async () => {
      const res = await request(app).post('/auth/register').send({ email: 'joao@teste.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('obrigatórios');
    });

    it('deve rejeitar email já cadastrado', async () => {
      (User.findOne as any).mockResolvedValue({ _id: 'existing', email: 'joao@teste.com' });

      const res = await request(app).post('/auth/register').send({
        name: 'João Silva',
        email: 'joao@teste.com',
        password: 'senha123',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('E-mail já cadastrado');
    });
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  describe('POST /auth/login', () => {
    it('deve fazer login com credenciais válidas', async () => {
      const mockUser = {
        _id: 'user-123',
        name: 'João Silva',
        email: 'joao@teste.com',
        comparePassword: vi.fn().mockResolvedValue(true),
      };
      (User.findOne as any).mockResolvedValue(mockUser);

      const res = await request(app).post('/auth/login').send({
        email: 'joao@teste.com',
        password: 'senha123',
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user.email).toBe('joao@teste.com');
    });

    it('deve rejeitar credenciais inválidas (usuário não existe)', async () => {
      (User.findOne as any).mockResolvedValue(null);

      const res = await request(app).post('/auth/login').send({
        email: 'inexistente@teste.com',
        password: 'senha123',
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Credenciais inválidas');
    });

    it('deve rejeitar senha incorreta', async () => {
      const mockUser = {
        _id: 'user-123',
        email: 'joao@teste.com',
        comparePassword: vi.fn().mockResolvedValue(false),
      };
      (User.findOne as any).mockResolvedValue(mockUser);

      const res = await request(app).post('/auth/login').send({
        email: 'joao@teste.com',
        password: 'senha_errada',
      });

      expect(res.status).toBe(401);
    });

    it('deve rejeitar login sem campos obrigatórios', async () => {
      const res = await request(app).post('/auth/login').send({ email: 'joao@teste.com' });
      expect(res.status).toBe(400);
    });
  });

  // ── Refresh Token ─────────────────────────────────────────────────────────
  describe('POST /auth/refresh', () => {
    it('deve renovar o access token com refresh token válido', async () => {
      const refreshToken = jwt.sign({ id: 'user-123' }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
      (User.findById as any).mockResolvedValue({
        _id: 'user-123',
        name: 'João Silva',
        email: 'joao@teste.com',
      });

      const res = await request(app).post('/auth/refresh').send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
    });

    it('deve rejeitar refresh token inválido', async () => {
      const res = await request(app).post('/auth/refresh').send({ refreshToken: 'token_invalido' });
      expect(res.status).toBe(403);
    });

    it('deve rejeitar quando refresh token não fornecido', async () => {
      const res = await request(app).post('/auth/refresh').send({});
      expect(res.status).toBe(401);
    });
  });

  // ── Rota Protegida /me ────────────────────────────────────────────────────
  describe('GET /auth/me', () => {
    it('deve retornar dados do usuário autenticado', async () => {
      const token = jwt.sign({ id: 'user-123', email: 'joao@teste.com', name: 'João' }, JWT_SECRET, { expiresIn: '15m' });
      (User.findById as any).mockResolvedValue({
        _id: 'user-123',
        name: 'João Silva',
        email: 'joao@teste.com',
      });

      const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('joao@teste.com');
    });

    it('deve rejeitar acesso sem token', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
    });

    it('deve rejeitar token expirado/inválido', async () => {
      const res = await request(app).get('/auth/me').set('Authorization', 'Bearer token_falso');
      expect(res.status).toBe(403);
    });
  });

  // ── JWT: validação e payload ───────────────────────────────────────────────
  describe('JWT Tokens', () => {
    it('access token deve ter payload correto', async () => {
      const mockUser = {
        _id: 'user-123',
        name: 'João Silva',
        email: 'joao@teste.com',
        comparePassword: vi.fn().mockResolvedValue(true),
      };
      (User.findOne as any).mockResolvedValue(mockUser);

      const res = await request(app).post('/auth/login').send({
        email: 'joao@teste.com',
        password: 'senha123',
      });

      const decoded = jwt.verify(res.body.accessToken, JWT_SECRET) as any;
      expect(decoded.id).toBe('user-123');
      expect(decoded.email).toBe('joao@teste.com');
    });
  });
});

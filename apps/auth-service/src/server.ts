import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import User from './models/User.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const MONGO_URI = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/auth';
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_123';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'super_refresh_secret_key_456';

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Auth Service' });
});

// Middleware de Autenticação para validar JWT
export const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Token inválido ou expirado' });
    req.user = user;
    next();
  });
};

// Rota de Registro
app.post('/auth/register', async (req, res: any) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Campos name, email e password são obrigatórios' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'E-mail já cadastrado' });
    }

    const user = new User({ name, email, passwordHash: password });
    await user.save();

    res.status(201).json({
      id: user._id,
      name: user.name,
      email: user.email
    });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro interno ao registrar usuário' });
  }
});

// Rota de Login
app.post('/auth/login', async (req, res: any) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Gerar Tokens
    const accessToken = jwt.sign(
      { id: user._id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno ao realizar login' });
  }
});

// Rota de Refresh Token
app.post('/auth/refresh', async (req, res: any) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token não fornecido' });

  try {
    jwt.verify(refreshToken, JWT_REFRESH_SECRET, async (err: any, payload: any) => {
      if (err) return res.status(403).json({ error: 'Refresh token inválido' });

      const user = await User.findById(payload.id);
      if (!user) return res.status(403).json({ error: 'Usuário não encontrado' });

      const accessToken = jwt.sign(
        { id: user._id, email: user.email, name: user.name },
        JWT_SECRET,
        { expiresIn: '15m' }
      );

      res.json({ accessToken });
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao renovar token' });
  }
});

// Obter Usuário Atual (Me)
app.get('/auth/me', authenticateToken, async (req: any, res: any) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar dados do usuário' });
  }
});

// Inicialização
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('🔑 Auth Service conectado ao MongoDB!');
    app.listen(PORT, () => {
      console.log(`🚀 Auth Service rodando na porta ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('❌ Erro de conexão no Auth Service MongoDB:', error);
  });

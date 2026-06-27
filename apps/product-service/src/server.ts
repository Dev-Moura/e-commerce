
import Product from './models/Product.ts'; // Importe o model
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// A URI do banco virá do arquivo .env, mas se não tiver, usa a porta local do port-forward
// Substitua 'admin123' pela senha que você configurou agora
// Lembre-se: usuario=mongo, senha=admin
const MONGO_URI = 'mongodb://mongo:admin@127.0.0.1:27017/products?authSource=admin&directConnection=true';
const PORT = process.env.PORT || 3001;

// Rota de Teste de Saúde (Healthcheck)
app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'Product Service' });
});

// Conexão com o Banco de Dados e inicialização do servidor
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('📦 Conectado ao MongoDB com sucesso!');
        app.listen(PORT, () => {
            console.log(`🚀 Product Service rodando na porta ${PORT}`);
        });
    })
    .catch((error) => {
        console.error('❌ Erro ao conectar no MongoDB:', error);
    });

// Rota para cadastrar produto
app.post('/products', async (req, res) => {
  try {
    const product = new Product(req.body);
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ error: 'Erro ao criar produto' });
  }
});

// Rota para listar produtos
app.get('/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});
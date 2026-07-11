
import Product from './models/Product.js'; // Importe o model
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectRabbitMQ, publishEvent } from './rabbitmq.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// AJUSTE AQUI: Usamos a variável de ambiente ou um valor padrão para o cluster
const MONGO_URI = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/products';
const PORT = process.env.PORT || 3001;

// Rota de Teste de Saúde (Healthcheck)
app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'Product Service' });
});

// Conexão com o Banco de Dados e inicialização do servidor
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('📦 Conectado ao MongoDB com sucesso!');
        await connectRabbitMQ();
        app.listen(PORT, () => {
            console.log(`🚀 Product Service rodando na porta ${PORT}`);
        });
    })
    .catch((error) => {
        console.error('❌ Erro ao conectar no MongoDB:', error);
    });

// Rota para cadastrar produto
app.post('/products', async (req, res: any) => {
  try {
    const product = new Product(req.body);
    await product.save();
    
    // Publica evento no RabbitMQ
    publishEvent('product.created', {
      id: product._id,
      name: product.name,
      description: product.description,
      price: product.price,
      stock: product.stock,
      category: product.category
    });

    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ error: 'Erro ao criar produto' });
  }
});

// Rota para atualizar produto
app.put('/products/:id', async (req, res: any) => {
  try {
    const { id } = req.params;
    const product = await Product.findByIdAndUpdate(id, req.body, { new: true });
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    // Publica evento no RabbitMQ
    publishEvent('product.updated', {
      id: product._id,
      name: product.name,
      description: product.description,
      price: product.price,
      stock: product.stock,
      category: product.category
    });

    res.json(product);
  } catch (error) {
    res.status(400).json({ error: 'Erro ao atualizar produto' });
  }
});

// Rota para listar produtos
app.get('/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

// Rota para obter um produto por ID
app.get('/products/:id', async (req, res: any) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json(product);
  } catch (error) {
    res.status(400).json({ error: 'Erro ao buscar produto' });
  }
});
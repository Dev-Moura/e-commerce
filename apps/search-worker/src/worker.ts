import amqp from 'amqplib';
import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq-service.infra:5672';
const ES_NODE = process.env.ELASTICSEARCH_URL || 'http://elasticsearch-service.infra:9200';

const elastic = new Client({
  node: ES_NODE,
  maxRetries: 5,
  requestTimeout: 60000,
});

async function startWorker() {
  try {
    // 1. Conectar ao Elasticsearch e aguardar estar pronto
    console.log('🔎 Tentando conectar ao Elasticsearch...');
    let esConnected = false;
    for (let i = 0; i < 10; i++) {
      try {
        await elastic.ping();
        esConnected = true;
        console.log('🔎 Conectado ao Elasticsearch com sucesso!');
        break;
      } catch (err) {
        console.log(`⚠️ Aguardando Elasticsearch... (${i+1}/10)`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    if (!esConnected) {
      throw new Error('Não foi possível conectar ao Elasticsearch');
    }

    // Criar índice com analisador em português, se não existir
    const indexExists = await elastic.indices.exists({ index: 'products' });
    if (!indexExists) {
      await elastic.indices.create({
        index: 'products',
        body: {
          settings: {
            analysis: {
              analyzer: {
                portuguese_analyzer: {
                  type: 'portuguese'
                }
              }
            }
          },
          mappings: {
            properties: {
              name: { type: 'text', analyzer: 'portuguese_analyzer' },
              description: { type: 'text', analyzer: 'portuguese_analyzer' },
              price: { type: 'float' },
              category: { type: 'keyword' },
              stock: { type: 'integer' }
            }
          }
        }
      });
      console.log('📊 Índice "products" criado no Elasticsearch com analisador em português!');
    }

    // 2. Conectar ao RabbitMQ e configurar a fila
    console.log('🐇 Tentando conectar ao RabbitMQ...');
    const conn = await amqp.connect(RABBITMQ_URL);
    const channel = await conn.createChannel();

    await channel.assertExchange('ecommerce_events', 'topic', { durable: true });
    
    const queueName = 'search_sync_queue';
    await channel.assertQueue(queueName, { durable: true });
    
    // Vincula a fila para receber todos os eventos de produto
    await channel.bindQueue(queueName, 'ecommerce_events', 'product.*');
    
    console.log(`🎧 Worker escutando a fila [${queueName}] no RabbitMQ...`);

    channel.consume(queueName, async (msg) => {
      if (!msg) return;

      try {
        const eventType = msg.fields.routingKey;
        const productData = JSON.parse(msg.content.toString());

        console.log(`✉️ Mensagem recebida [${eventType}]:`, productData);

        if (eventType === 'product.created' || eventType === 'product.updated') {
          await elastic.index({
            index: 'products',
            id: productData.id,
            document: {
              name: productData.name,
              description: productData.description,
              price: productData.price,
              category: productData.category,
              stock: productData.stock
            }
          });
          console.log(`✅ Produto indexado com sucesso no Elasticsearch: ${productData.name}`);
        }

        channel.ack(msg);
      } catch (err) {
        console.error('❌ Erro ao processar evento de indexação:', err);
        // Em caso de erro, re-enfileira a mensagem
        channel.nack(msg, false, true);
      }
    });

  } catch (error) {
    console.error('❌ Erro crítico no Search Worker:', error);
    setTimeout(startWorker, 10000);
  }
}

startWorker();
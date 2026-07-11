import amqp from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq-service.infra:5672';
let channel: amqp.Channel | null = null;

export async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    // Usamos um exchange do tipo 'topic' para rotear eventos de forma flexível
    await channel.assertExchange('ecommerce_events', 'topic', { durable: true });
    console.log('🐇 Product Service conectado ao RabbitMQ com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao conectar ao RabbitMQ no Product Service:', error);
    setTimeout(connectRabbitMQ, 5000);
  }
}

export function publishEvent(routingKey: string, message: any) {
  if (!channel) {
    console.warn('⚠️ RabbitMQ channel não inicializado. Evento não enviado:', routingKey);
    return;
  }
  channel.publish(
    'ecommerce_events',
    routingKey,
    Buffer.from(JSON.stringify(message)),
    { persistent: true }
  );
  console.log(`✉️ Evento enviado [${routingKey}]:`, message);
}

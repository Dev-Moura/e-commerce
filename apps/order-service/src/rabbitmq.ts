import amqp from 'amqplib';
import Order from './models/Order.js';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq-service.infra:5672';
let channel: amqp.Channel | null = null;

export async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    
    await channel.assertExchange('ecommerce_events', 'topic', { durable: true });
    
    // Configurar fila para escutar eventos de pagamento
    const queueName = 'order_payment_updates_queue';
    await channel.assertQueue(queueName, { durable: true });
    
    // Escuta tanto payment.succeeded quanto payment.failed
    await channel.bindQueue(queueName, 'ecommerce_events', 'payment.*');
    
    console.log('🐇 Order Service conectado ao RabbitMQ e escutando eventos de pagamento...');
    
    channel.consume(queueName, async (msg) => {
      if (!msg) return;
      
      try {
        const eventType = msg.fields.routingKey;
        const paymentData = JSON.parse(msg.content.toString());
        console.log(`✉️ Recebido evento de pagamento [${eventType}]:`, paymentData);
        
        const { orderId } = paymentData;
        let newStatus: 'PAID' | 'FAILED' = 'FAILED';
        
        if (eventType === 'payment.succeeded') {
          newStatus = 'PAID';
        } else if (eventType === 'payment.failed') {
          newStatus = 'FAILED';
        }
        
        const order = await Order.findByIdAndUpdate(orderId, { status: newStatus }, { new: true });
        if (order) {
          console.log(`✅ Status do pedido ${orderId} atualizado para ${newStatus}`);
        } else {
          console.warn(`⚠️ Pedido ${orderId} não encontrado ao processar atualização de pagamento`);
        }
        
        channel?.ack(msg);
      } catch (err) {
        console.error('❌ Erro ao atualizar status do pedido a partir do evento:', err);
        channel?.nack(msg, false, true);
      }
    });
  } catch (error) {
    console.error('❌ Erro ao conectar ao RabbitMQ no Order Service:', error);
    setTimeout(connectRabbitMQ, 5000);
  }
}

export function publishEvent(routingKey: string, message: any) {
  if (!channel) {
    console.warn('⚠️ RabbitMQ channel não inicializado. Evento de pedido não enviado:', routingKey);
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

import amqp from 'amqplib';
import { query } from './db.js';
import { CircuitBreaker } from './circuitBreaker.js';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq-service.infra:5672';
let channel: amqp.Channel | null = null;

// Simulação de gateway externo de pagamento
async function simulateExternalGateway(orderId: string, amount: number): Promise<string> {
  // Simular falhas aleatórias de rede/serviço para testar o Circuit Breaker
  // Se o valor do pedido terminar em .99, simulamos uma falha do gateway externo!
  if (amount % 1 === 0.99) {
    throw new Error('External Gateway connection timeout');
  }

  // Simular atraso na resposta do gateway
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Simula pagamento aprovado ou recusado (ex: saldo insuficiente para valores > 5000)
  if (amount > 5000) {
    throw new Error('Declined: Insufficient funds'); // Isto é erro de negócio, não falha técnica!
  }

  return 'txn_' + Math.random().toString(36).substr(2, 9);
}

// Criar o Circuit Breaker encapsulando o gateway externo
const gatewayBreaker = new CircuitBreaker(simulateExternalGateway, {
  failureThreshold: 3,
  recoveryTimeout: 15000 // 15 segundos em OPEN
});

export async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    
    await channel.assertExchange('ecommerce_events', 'topic', { durable: true });
    
    const queueName = 'payment_processing_queue';
    await channel.assertQueue(queueName, { durable: true });
    
    // Vincula a fila para escutar eventos de pedido criado
    await channel.bindQueue(queueName, 'ecommerce_events', 'order.created');
    
    console.log('🐇 Payment Service conectado ao RabbitMQ e pronto para processar pagamentos...');
    
    channel.consume(queueName, async (msg) => {
      if (!msg) return;
      
      const orderData = JSON.parse(msg.content.toString());
      const { orderId, totalAmount } = orderData;
      const idempotencyKey = `order_${orderId}`;

      console.log(`💳 Processando pagamento para o pedido: ${orderId}, total: R$${totalAmount}`);
      
      try {
        // 1. Verificar idempotência
        const checkIdempotency = await query(
          'SELECT status, response_body FROM idempotency_keys WHERE key = $1',
          [idempotencyKey]
        );

        if (checkIdempotency.rows.length > 0) {
          const { status, response_body } = checkIdempotency.rows[0];
          console.log(`ℹ️ Idempotência atingida para a chave: ${idempotencyKey}. Status: ${status}`);
          
          if (status === 'SUCCESS') {
            // Já processado com sucesso, apenas re-envia o evento de sucesso caso tenha se perdido
            publishEvent('payment.succeeded', { orderId, transactionId: response_body });
            channel?.ack(msg);
            return;
          } else if (status === 'FAILED') {
            // Já processado e falhou, re-envia evento de falha
            publishEvent('payment.failed', { orderId, reason: response_body });
            channel?.ack(msg);
            return;
          } else if (status === 'PROCESSING') {
            // Já está sendo processado por outro worker, re-enfileirar para aguardar
            console.log(`⏳ Pagamento do pedido ${orderId} já está em processamento. Re-enfileirando...`);
            setTimeout(() => {
              channel?.nack(msg, false, true);
            }, 2000);
            return;
          }
        }

        // Registrar início do processamento (Bloqueio de Idempotência)
        await query(
          'INSERT INTO idempotency_keys (key, status) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET status = $2',
          [idempotencyKey, 'PROCESSING']
        );

        let transactionId: string;
        try {
          // 2. Executar gateway externo através do Circuit Breaker
          transactionId = await gatewayBreaker.execute(orderId, totalAmount);
          
          // 3. Salvar pagamento aprovado no PostgreSQL
          await query(
            'INSERT INTO payments (order_id, amount, status, transaction_id) VALUES ($1, $2, $3, $4)',
            [orderId, totalAmount, 'APPROVED', transactionId]
          );

          // Atualizar status de idempotência para SUCCESS
          await query(
            'UPDATE idempotency_keys SET status = $1, response_body = $2 WHERE key = $3',
            ['SUCCESS', transactionId, idempotencyKey]
          );

          // Publicar sucesso no RabbitMQ
          publishEvent('payment.succeeded', { orderId, transactionId });
          
          channel?.ack(msg);
        } catch (gatewayErr: any) {
          const isBusinessDeclined = gatewayErr.message.includes('Declined');
          
          if (isBusinessDeclined) {
            // Pagamento recusado (Erro de negócio - não deve ser retentado no circuito)
            console.warn(`❌ Pagamento recusado pelo gateway para o pedido ${orderId}: ${gatewayErr.message}`);
            
            await query(
              'INSERT INTO payments (order_id, amount, status, transaction_id) VALUES ($1, $2, $3, $4)',
              [orderId, totalAmount, 'DECLINED', null]
            );

            await query(
              'UPDATE idempotency_keys SET status = $1, response_body = $2 WHERE key = $3',
              ['FAILED', gatewayErr.message, idempotencyKey]
            );

            // Publicar falha no RabbitMQ
            publishEvent('payment.failed', { orderId, reason: gatewayErr.message });
            channel?.ack(msg);
          } else {
            // Erro de rede ou sistema (Ex: Circuit Breaker aberto ou Timeout)
            // Lançar erro para acionar o bloco catch externo que fará o re-enfileiramento
            throw gatewayErr;
          }
        }
      } catch (err: any) {
        console.error(`❌ Falha de infraestrutura no processamento do pedido ${orderId}:`, err.message || err);
        
        // Resetar o status de idempotência para permitir nova tentativa futura
        await query(
          'DELETE FROM idempotency_keys WHERE key = $1 AND status = $2',
          [idempotencyKey, 'PROCESSING']
        );

        // Se o erro foi que o Circuit Breaker está ABERTO ou banco falhou, re-enfileiramos o evento para tentar novamente
        console.log(`🔄 Re-enfileirando pedido ${orderId} no RabbitMQ para reprocessamento futuro.`);
        setTimeout(() => {
          channel?.nack(msg, false, true); // requeue = true
        }, 5000); // Aguarda 5 segundos antes de re-enfileirar para evitar loop de CPU
      }
    });

  } catch (error) {
    console.error('❌ Erro ao conectar ao RabbitMQ no Payment Service:', error);
    setTimeout(connectRabbitMQ, 5000);
  }
}

export function publishEvent(routingKey: string, message: any) {
  if (!channel) {
    console.warn('⚠️ RabbitMQ channel não inicializado. Evento de pagamento não enviado:', routingKey);
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

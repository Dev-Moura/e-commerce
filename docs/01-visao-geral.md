# 📖 Visão Geral do Projeto

## O que é este projeto?

Este projeto é uma **plataforma de e-commerce completa** construída sobre uma arquitetura de **microsserviços event-driven**. O objetivo não é apenas ter uma loja funcional, mas demonstrar como sistemas de alta disponibilidade são projetados e operados em ambientes reais de produção.

A plataforma cobre o ciclo completo de um e-commerce:

```
Usuário se registra → Navega produtos → Cria pedido → Pagamento é processado → Catálogo é indexado para busca
```

Cada uma dessas responsabilidades vive em um serviço independente, isolado e substituível.

---

## Por que Microsserviços?

### O problema com Monolitos em E-commerce

Um monolito tradicional coloca todo o código em uma única aplicação. Isso funciona bem no início, mas um e-commerce cresce de formas assimétricas:

- No Black Friday, o serviço de **pagamentos** recebe 50x mais carga que o normal
- O **catálogo de busca** precisa de indexação em tempo real sem travar o checkout
- Um bug no módulo de **relatórios** não pode derrubar o fluxo de **compras**

Em um monolito, esses problemas são impossíveis de resolver sem refatorar o sistema inteiro.

### O que ganhamos com Microsserviços

| Problema no Monolito | Solução com Microsserviços |
|---|---|
| Escalar tudo ou nada | Escalar só o serviço sobrecarregado |
| Deploy afeta toda a aplicação | Deploy independente por serviço |
| Falha em módulo derruba tudo | Isolamento de falhas (resiliência) |
| Tecnologia única para tudo | Cada serviço usa a melhor tech para seu problema |
| Time inteiro trabalha no mesmo código | Times autônomos por domínio |

---

## A escolha de Event-Driven Architecture

### Por que eventos e não chamadas diretas (REST entre serviços)?

Imagine o fluxo de criação de pedido com chamadas síncronas:

```
Order Service → chama → Payment Service → chama → Search Worker → chama → Notification Service
```

**Problemas:**
- Se o Payment Service estiver lento, o Order Service trava esperando
- Se o Search Worker cair, o pedido falha mesmo que o pagamento tenha sido processado
- Acoplamento forte: qualquer mudança no contrato quebra a cadeia

### Com eventos (RabbitMQ):

```
Order Service → publica evento "order.created" → RabbitMQ
                                                      │
                                     ┌────────────────┼────────────────┐
                                     ▼                ▼                ▼
                              Payment Service   Search Worker   Notification (futuro)
```

**Vantagens:**
- Order Service não sabe quem consome o evento — **desacoplamento total**
- Se o Search Worker estiver fora, o evento fica na fila até ele voltar — **durabilidade**
- Novos consumidores podem ser adicionados sem tocar no produtor — **extensibilidade**

---

## Diagrama Completo do Sistema

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NAMESPACE: apps                             │
│                                                                     │
│  ┌─────────┐     HTTP/REST    ┌──────────────────────────────────┐  │
│  │ Browser │ ──────────────► │   NGINX Ingress Controller        │  │
│  └─────────┘                 └──────────────────────────────────┘  │
│                                          │                          │
│              ┌───────────────────────────┼─────────────────────┐   │
│              ▼                           ▼                      ▼   │
│    ┌──────────────────┐    ┌──────────────────┐   ┌──────────────┐ │
│    │   auth-service   │    │ product-service  │   │order-service │ │
│    │  :3001           │    │  :3002           │   │  :3003       │ │
│    └──────────────────┘    └──────────────────┘   └──────────────┘ │
│             │                        │                    │         │
│             │                        │ product.created    │order.created
│             │                        │                    │         │
└─────────────┼────────────────────────┼────────────────────┼─────────┘
              │                        │                    │
┌─────────────┼────────────────────────┼────────────────────┼─────────┐
│             │    NAMESPACE: infra    │                    │         │
│             │                        ▼                    ▼         │
│             │              ┌──────────────────────────────────┐     │
│             │              │          RabbitMQ                │     │
│             │              │   Exchange: ecommerce_events     │     │
│             │              └──────────────────────────────────┘     │
│             │                        │                    │         │
│             │               ┌────────┘          ┌─────────┘         │
│             │               ▼                   ▼                   │
│             │     ┌──────────────────┐  ┌────────────────────┐     │
│             │     │  search-worker   │  │  payment-service   │     │
│             │     └──────────────────┘  │     :3004          │     │
│             │              │            └────────────────────┘     │
│             │              ▼                    │                   │
│             │      ┌─────────────┐              ▼                  │
│             │      │Elasticsearch│      ┌──────────────┐           │
│      ┌──────┘      └─────────────┘      │  PostgreSQL  │           │
│      ▼                                  └──────────────┘           │
│  ┌────────┐                                                        │
│  │MongoDB │ (3 instâncias: auth, products, orders)                 │
│  └────────┘                                                        │
└────────────────────────────────────────────────────────────────────┘
```

---

## Fluxo de Dados Completo

### 1. Registro e Autenticação
```
POST /auth/register → auth-service → MongoDB → JWT retornado
POST /auth/login    → auth-service → bcrypt hash check → Access Token + Refresh Token
GET  /auth/me       → auth-service → JWT validation → dados do usuário
```

### 2. Catálogo de Produtos
```
POST /products → product-service → MongoDB → publica "product.created" no RabbitMQ
                                                              │
                                                              ▼
                                                    search-worker consome
                                                              │
                                                              ▼
                                                    Indexa no Elasticsearch
```

### 3. Criação de Pedido com Pagamento
```
POST /orders → order-service → calcula total → salva no MongoDB
                                             → publica "order.created" no RabbitMQ
                                                              │
                                                              ▼
                                               payment-service consome
                                                              │
                                               CircuitBreaker protege gateway
                                                              │
                                                    ┌─────────┴──────────┐
                                                    ▼                    ▼
                                            sucesso: publica         falha: publica
                                         "payment.succeeded"       "payment.failed"
                                                    │                    │
                                                    └─────────┬──────────┘
                                                              ▼
                                               order-service atualiza status
                                               do pedido no MongoDB
```

---

## Próximas Evoluções Previstas

| Feature | Benefício |
|---|---|
| Redis para cache de catálogo | Respostas abaixo de 5ms para produtos populares |
| Grafana + Loki para logs | Rastreabilidade de ponta a ponta com `correlation_id` |
| Idempotency Keys no pagamento | Elimina cobranças duplicadas por retry |
| CI/CD com GitHub Actions | Deploy automático no push para `main` |

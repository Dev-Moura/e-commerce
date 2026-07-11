# 🧰 Tecnologias e Justificativas

Este documento explica **cada tecnologia escolhida**, o problema que ela resolve e por que foi preferida em relação às alternativas.

---

## 1. Node.js + TypeScript — Backend de todos os microsserviços

### Por que Node.js?

Node.js usa um modelo de **I/O não bloqueante e orientado a eventos** (event loop). Isso significa que um único processo consegue lidar com milhares de conexões simultâneas sem criar uma thread por requisição.

**E-commerce é I/O-bound por natureza:**
- Consultas ao banco
- Chamadas a serviços externos (gateway de pagamento)
- Publicação e consumo de mensagens

Em um servidor Java ou Python síncrono tradicional, cada requisição ocupa uma thread enquanto espera o banco responder. No Node.js, a thread fica livre e atende outras requisições durante esse tempo.

```
Modelo síncrono (Python/Java tradicional):
Req 1 ──[waiting DB]──────────────────► Resp
Req 2    ──[waiting DB]──────────────► Resp
Req 3       ──[waiting DB]───────────► Resp
(3 threads bloqueadas)

Modelo Node.js (event loop):
Req 1 ──►[async DB call]──────────────► Resp  ← libera a thread imediatamente
Req 2 ──►[async DB call]────────────► Resp
Req 3 ──►[async DB call]──────────► Resp
(1 thread, sem bloqueio)
```

### Por que TypeScript?

TypeScript adiciona **tipagem estática** ao JavaScript. Em um sistema com múltiplos serviços que se comunicam via eventos e APIs, os tipos funcionam como contratos entre sistemas:

```typescript
// Sem TypeScript — erro só aparece em runtime
const event = JSON.parse(msg);
processPayment(event.ordreId); // typo: "ordreId" em vez de "orderId"

// Com TypeScript — erro aparece no editor, antes do deploy
interface PaymentEvent {
  orderId: string;
  amount: number;
}
const event: PaymentEvent = JSON.parse(msg);
processPayment(event.ordreId); // ❌ Erro: Property 'ordreId' does not exist
```

**Benefícios concretos no projeto:**
- Contratos de eventos tipados entre serviços
- Autocompletar nos modelos do Mongoose
- Refatorações seguras (o compilador encontra todos os usos)
- Testes mais confiáveis (mocks com tipos corretos)

**Alternativas consideradas:**
- **Go** — ótimo para performance, mas curva de aprendizado maior e ecossistema menor para este domínio
- **Python (FastAPI)** — excelente, mas a inconsistência de linguagem (JS no front, Python no back) aumenta o contexto necessário

---

## 2. MongoDB — Banco principal (auth, products, orders)

### Por que MongoDB para esses domínios?

Produtos de e-commerce têm **esquemas extremamente variados**:

```json
// Produto eletrônico
{ "nome": "TV 55\"", "voltagem": "Bivolt", "resolucao": "4K", "smart": true }

// Produto de roupa
{ "nome": "Camiseta", "tamanho": ["P", "M", "G"], "cor": "Azul", "material": "Algodão" }
```

Em SQL, modelar isso exigiria tabelas de atributos dinâmicos (EAV — Entity-Attribute-Value), que são complexas e lentas. No MongoDB, o documento simplesmente carrega seus próprios campos.

**Outros benefícios:**
- **Formato JSON nativo** — zero transformação entre o código TypeScript e o banco
- **Mongoose ODM** — validação de esquema, hooks e relacionamentos com tipagem TypeScript
- **Escalabilidade horizontal** — sharding nativo para grandes volumes
- **Queries de array** — queries como `tamanho: { $in: ["M", "G"] }` são triviais

**Por que NÃO usar SQL aqui?**
- Não há transações financeiras (esse é o papel do PostgreSQL)
- Os dados não têm relacionamentos complexos entre entidades diferentes
- A flexibilidade do schema é uma funcionalidade, não uma deficiência

---

## 3. PostgreSQL — Banco de pagamentos

### Por que PostgreSQL exclusivamente para pagamentos?

Operações financeiras são o caso de uso clássico para bancos relacionais com suporte total a **ACID**:

| Propriedade ACID | O que garante |
|---|---|
| **Atomicidade** | A transação inteira acontece ou nenhuma parte acontece |
| **Consistência** | O banco sempre passa de um estado válido para outro |
| **Isolamento** | Transações concorrentes não interferem entre si |
| **Durabilidade** | Uma vez confirmada, a transação nunca é perdida |

**Cenário real que o ACID previne:**

```
Cenário: dois cliques simultâneos no botão "Pagar"

Sem ACID:
1. Req A: lê saldo = R$500, inicia débito
2. Req B: lê saldo = R$500, inicia débito (leu antes de A concluir)
3. Req A: salva saldo = R$400
4. Req B: salva saldo = R$400  ← ERRO: debitou apenas R$100 em vez de R$200

Com PostgreSQL + Isolamento de transação:
1. Req A: lê e bloqueia a linha
2. Req B: espera desbloqueio
3. Req A: salva saldo = R$400, commit
4. Req B: lê saldo = R$400, debita R$100, salva R$300, commit ← CORRETO
```

**Idempotency Keys (implementação prevista):**
```sql
CREATE TABLE idempotency_keys (
  key VARCHAR PRIMARY KEY,
  response JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```
Se a rede travar e o cliente reenviar o mesmo pagamento, o sistema retorna a resposta anterior em vez de processar novamente.

---

## 4. RabbitMQ — Mensageria e comunicação assíncrona

### O que é e por que foi escolhido?

RabbitMQ é um **message broker** — um intermediário que recebe mensagens de produtores e as entrega a consumidores, garantindo que nenhuma mensagem seja perdida.

### Modelo adotado: Topic Exchange

```
Exchange: ecommerce_events (tipo: topic)
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
product.*   order.*    payment.*
    │           │           │
 search-     payment-    order-
 worker      service     service
```

Uma **topic exchange** roteia mensagens por padrões de routing key:
- `product.created` → consome search-worker
- `order.created` → consome payment-service
- `payment.*` → consome order-service (captura `payment.succeeded` e `payment.failed`)

### Por que RabbitMQ e não Kafka?

| | RabbitMQ | Apache Kafka |
|---|---|---|
| **Modelo** | Push (entrega ativa) | Pull (consumidores buscam) |
| **Melhor para** | Filas de tarefas, RPC, eventos transacionais | Streaming de eventos, replay histórico, big data |
| **Complexidade** | Baixa | Alta (requer ZooKeeper/KRaft) |
| **Recursos locais** | Leve (~200MB RAM) | Pesado (~1GB+ RAM) |
| **Garantia de entrega** | ACK por mensagem | Baseado em offset |

Para este projeto, RabbitMQ é a escolha certa:
- **Eventos transacionais** (pedido criado, pagamento processado) — não precisamos de replay histórico
- **Ambiente Kubernetes local (Minikube)** — recursos limitados favorecem leveza
- **ACK/NACK por mensagem** — se o payment-service falhar ao processar, a mensagem volta para a fila automaticamente

```typescript
// Acknowledgment explícito — mensagem só é removida da fila após processamento
channel.consume(queue, async (msg) => {
  try {
    await processarPagamento(msg);
    channel.ack(msg);    // ✅ Sucesso: remove da fila
  } catch (err) {
    channel.nack(msg, false, true); // ❌ Falha: recoloca na fila
  }
});
```

---

## 5. Elasticsearch — Motor de busca

### Por que não buscar direto no MongoDB?

```javascript
// MongoDB full-text search
db.products.find({ $text: { $search: "celular samsung" } })
// Limitações: sem fuzzy search, sem relevância por campo, sem filtros facetados
```

Elasticsearch é especializado em busca e oferece:

| Feature | MongoDB | Elasticsearch |
|---|---|---|
| Fuzzy search (erros de digitação) | ❌ | ✅ "samusung" encontra "samsung" |
| Relevância por peso de campo | ❌ | ✅ título > descrição |
| Filtros facetados | Limitado | ✅ Por marca, preço, categoria |
| Analyzers de idioma | ❌ | ✅ Remove acentos, trata plural |
| Performance em texto livre | Lento | Sub-100ms |

### Padrão CQRS aplicado

O projeto usa **CQRS simplificado** (Command Query Responsibility Segregation):

```
Escrita (Command):
POST /products → product-service → MongoDB (fonte da verdade)
                                 → publica "product.created"

Leitura (Query):
GET /search?q=celular → Elasticsearch (otimizado para leitura)
```

O **search-worker** mantém o Elasticsearch sincronizado com o MongoDB via eventos RabbitMQ. A separação garante que a escrita nunca seja bloqueada pela indexação.

---

## 6. Kubernetes + Minikube — Orquestração

### Por que Kubernetes?

Docker resolve "como empacotar". Kubernetes resolve "como operar em escala":

| Problema | Como o K8s resolve |
|---|---|
| Serviço caiu | Reinicia automaticamente (health probes) |
| Pico de tráfego | Horizontal Pod Autoscaler aumenta réplicas |
| Deploy sem downtime | Rolling update — troca pods gradualmente |
| Descoberta de serviços | DNS interno: `rabbitmq-service.infra:5672` |
| Segredos e configs | ConfigMaps e Secrets separados do código |

### Organização em Namespaces

```
Namespace: infra
├── mongodb (3 instâncias: auth, products, orders)
├── postgresql
├── rabbitmq
└── elasticsearch

Namespace: apps
├── auth-service
├── product-service
├── order-service
├── payment-service
├── search-worker
└── frontend (servido por NGINX)
```

A separação em namespaces simula isolamento de rede de ambientes corporativos reais. A infraestrutura não está exposta diretamente aos clientes.

### Por que Minikube (local)?

Minikube roda um cluster Kubernetes completo localmente, permitindo:
- Testar manifests YAML exatamente como em produção
- Usar Ingress Controller, PersistentVolumes e namespaces reais
- Desenvolver sem custos de cloud

---

## 7. Circuit Breaker — Resiliência no Payment Service

### O problema: falhas em cascata

```
Cenário sem Circuit Breaker:
Gateway externo começa a falhar → todas as requisições travam esperando timeout de 30s
→ fila de requisições cresce → memória esgota → payment-service cai
→ order-service não consegue confirmar pedidos → experiência do usuário destruída
```

### A solução: Circuit Breaker (padrão de design)

Inspirado nos disjuntores elétricos, o Circuit Breaker tem 3 estados:

```
                    3 falhas consecutivas
CLOSED ─────────────────────────────────► OPEN
(funcionando)                           (rejeitando)
   ▲                                        │
   │ 1 sucesso                    10s de    │
   │                               espera   │
   └───────────── HALF-OPEN ◄──────────────┘
                 (testando)
```

```typescript
// Implementação no projeto
const circuitBreaker = new CircuitBreaker(gatewayDePagamento, {
  failureThreshold: 3,    // Abre após 3 falhas
  recoveryTimeout: 10000  // Aguarda 10s antes de testar novamente
});

// Em vez de chamar o gateway diretamente:
await circuitBreaker.execute(orderId, amount);
// Se OPEN → rejeita imediatamente com erro amigável
// Se CLOSED → chama o gateway normalmente
// Se HALF-OPEN → testa com uma chamada, decide se fecha ou reabre
```

**Por que implementar do zero em vez de usar uma biblioteca?**
- Controle total sobre o comportamento
- Sem dependências externas desnecessárias
- Demonstra domínio do padrão, não apenas uso de ferramenta

---

## 8. React + Vite — Frontend

### Por que React?

React é a biblioteca de UI mais adotada no mercado, com o maior ecossistema. Para um e-commerce:
- **Componentes reutilizáveis** — ProductCard, CartItem, Checkout podem ser compostos
- **Virtual DOM** — atualizações eficientes na lista de produtos (sem re-render da página inteira)
- **Hooks** — `useState`, `useEffect` para gerenciar estado de carrinho e autenticação

### Por que Vite em vez de Create React App?

```
Create React App (webpack):   cold start ~30s, HMR ~2-5s
Vite (esbuild + ESM nativo):  cold start ~300ms, HMR ~50ms
```

Vite usa **ES Modules nativos do browser** em desenvolvimento. O browser carrega apenas o módulo que foi alterado, sem re-bundlar tudo.

### Servido por NGINX em produção

O build do React gera arquivos estáticos (`index.html`, `bundle.js`, `assets/`). No Kubernetes, um container NGINX serve esses arquivos com:
- **Gzip** automático
- **Cache-Control** para assets imutáveis
- **SPA fallback** — todas as rotas retornam `index.html` para o React Router funcionar

---

## 9. JWT — Autenticação Stateless

### Access Token + Refresh Token

```
Login → auth-service gera:
  ┌─ Access Token (JWT) → expira em 15min, enviado em cada request
  └─ Refresh Token      → expira em 7 dias, armazenado em httpOnly cookie
```

**Por que dois tokens?**

| | Access Token | Refresh Token |
|---|---|---|
| **Duração** | 15 minutos | 7 dias |
| **Onde fica** | Header `Authorization` | Cookie httpOnly |
| **Risco se vazar** | Baixo (expira rápido) | Maior (mas não acessível por JS) |
| **Uso** | Toda request autenticada | Só para renovar access token |

**Stateless** significa que os microsserviços **não precisam consultar o banco** para validar um token — a assinatura criptográfica (HMAC-SHA256) é suficiente:

```typescript
// Validação sem hit no banco
const payload = jwt.verify(token, process.env.JWT_SECRET!);
// Se a assinatura for válida e não expirou → usuário autenticado
```

---

## 10. Vitest — Framework de Testes

### Por que Vitest e não Jest?

| | Vitest | Jest |
|---|---|---|
| **Compatibilidade** | ESM nativo | Precisa de transformação |
| **Performance** | Paralelismo via workers Vite | Mais lento |
| **Config** | Zero config com Vite/TS | Requer babel/ts-jest |
| **API** | Idêntica ao Jest | — |

O projeto usa TypeScript com `"type": "module"` (ES Modules puro). Jest com ESM requer configuração trabalhosa. Vitest funciona nativamente.

**Cobertura de testes atual:**

```
auth-service:    15 testes → register, login, refresh token, JWT payload
product-service:  9 testes → CRUD + publicação de eventos RabbitMQ
order-service:   11 testes → criação, cálculo de total, filtros, eventos
payment-service: 17 testes → pagamentos + Circuit Breaker (CLOSED/OPEN/HALF-OPEN)
─────────────────────────────────────────────────────
Total:           52 testes ✅ (100% passing)
```

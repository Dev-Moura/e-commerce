# 🛒 E-Commerce Microservices

Uma plataforma de e-commerce construída com arquitetura de **microsserviços event-driven**, orquestrada em **Kubernetes** com comunicação assíncrona via **RabbitMQ**.

---

## 📐 Arquitetura

```
[ React.js Frontend ]
         │
         ▼  HTTP / REST
[ NGINX Ingress Controller ]
         │
         ├──► [ Auth Service ]        ──► MongoDB (auth-db)
         │
         ├──► [ Product Service ]     ──► MongoDB (main-db)
         │         │
         │         └─► product.created ──► [ RabbitMQ ] ──► [ Search Worker ] ──► Elasticsearch
         │
         ├──► [ Order Service ]       ──► MongoDB (orders-db)
         │         │
         │         └─► order.created ───► [ RabbitMQ ]
         │                                      │
         └──► [ Payment Service ] ◄─────────────┘
                   │
                   └──► PostgreSQL (payment-db)
```

---

## 🧩 Serviços

| Serviço | Tecnologia | Banco | Porta |
|---|---|---|---|
| **auth-service** | Node.js + TypeScript | MongoDB | 3001 |
| **product-service** | Node.js + TypeScript | MongoDB | 3002 |
| **order-service** | Node.js + TypeScript | MongoDB | 3003 |
| **payment-service** | Node.js + TypeScript | PostgreSQL | 3004 |
| **search-worker** | Node.js + TypeScript | Elasticsearch | — |
| **frontend** | React + Vite + TypeScript | — | 80 |

---

## 🛠️ Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend | React.js + TypeScript + Vite |
| Backend | Node.js + TypeScript + Express |
| Banco principal | MongoDB |
| Banco de pagamentos | PostgreSQL |
| Motor de busca | Elasticsearch |
| Mensageria | RabbitMQ |
| Orquestração | Kubernetes (Minikube) |
| Containerização | Docker |
| Autenticação | JWT (Access + Refresh Tokens) |
| Resiliência | Circuit Breaker (payment-service) |

---

## 📁 Estrutura do Monorepo

```
e-commerce/
├── apps/
│   ├── auth-service/       # Autenticação JWT
│   ├── product-service/    # Catálogo de produtos + eventos RabbitMQ
│   ├── order-service/      # Gestão de pedidos
│   ├── payment-service/    # Pagamentos + Circuit Breaker
│   ├── search-worker/      # Sincroniza produtos no Elasticsearch
│   └── frontend/           # Interface React
├── k8s/
│   ├── infra/              # MongoDB, PostgreSQL, RabbitMQ, Elasticsearch
│   └── apps/               # Deployments dos microsserviços + Ingress
├── tests/
│   ├── infra/              # Health check do cluster K8s
│   └── run-all-tests.sh    # Executa todos os testes
└── Makefile                # Automação de build e deploy
```

---

## 🚀 Como Rodar Localmente

### Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/)
- [Minikube](https://minikube.sigs.k8s.io/docs/start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Node.js](https://nodejs.org/) >= 18

### 1. Subir o Minikube

```bash
minikube start
```

### 2. Build das imagens Docker dentro do Minikube

```bash
make build-minikube
```

### 3. Deploy da infraestrutura e dos serviços

```bash
make k8s-deploy
```

### 4. Configurar o `/etc/hosts`

```bash
make show-hosts
# Cole as linhas exibidas no seu /etc/hosts
```

### 5. Acessar a aplicação

| URL | Descrição |
|---|---|
| `http://ecommerce.local` | Frontend React |
| `http://api.ecommerce.local/auth` | Auth Service |
| `http://api.ecommerce.local/products` | Product Service |
| `http://api.ecommerce.local/orders` | Order Service |
| `http://api.ecommerce.local/payments` | Payment Service |

---

## 🧪 Testes

### Rodar todos os testes unitários

```bash
make test-unit
```

### Rodar health check da infraestrutura K8s

```bash
make test-infra
```

### Rodar tudo

```bash
make test
```

### Resultados dos testes unitários

| Serviço | Testes | Status |
|---|---|---|
| auth-service | 15 | ✅ |
| product-service | 9 | ✅ |
| order-service | 11 | ✅ |
| payment-service | 17 | ✅ |
| **Total** | **52** | ✅ |

---

## 🔧 Comandos do Makefile

```bash
make help             # Lista todos os comandos disponíveis
make build-apps       # Build das imagens Docker localmente
make build-minikube   # Build das imagens dentro do Minikube
make k8s-deploy       # Aplica todos os manifests no Minikube
make k8s-undeploy     # Remove todos os recursos do cluster
make show-hosts       # Exibe as entradas para o /etc/hosts
make install-test-deps # Instala dependências de teste
make test-unit        # Executa unit tests de todos os serviços
make test-infra       # Executa testes de saúde do cluster K8s
make test             # Executa TODOS os testes
```

---

## 🌿 Branches

| Branch | Conteúdo |
|---|---|
| `main` | Branch principal |
| `infra` | Manifests Kubernetes, Makefile e scripts de teste |
| `auth` | Auth Service (JWT, bcrypt, MongoDB) |
| `micro` | Product, Order, Payment e Search Worker |
| `app` | Frontend React + Vite |

---

## ⚙️ Padrões Arquiteturais

- **Event-Driven** — serviços se comunicam via eventos no RabbitMQ (ex: `product.created`, `order.created`)
- **CQRS simplificado** — Product Service grava no MongoDB e publica evento; Search Worker indexa no Elasticsearch
- **Circuit Breaker** — Payment Service protege chamadas ao gateway com abertura automática de circuito
- **Idempotency Keys** — evita cobranças duplicadas no PostgreSQL
- **Stateless Auth** — Access Token de curta duração + Refresh Token para renovação transparente

---

## 📄 Licença

MIT

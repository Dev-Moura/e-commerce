# 🗺️ Guia de Desenvolvimento

## Configuração do Ambiente Local

### Pré-requisitos

```bash
# Verificar versões necessárias
node --version    # >= 18.x
docker --version  # >= 24.x
minikube version  # >= 1.30
kubectl version   # >= 1.27
```

### Primeira execução

```bash
# 1. Clonar o repositório
git clone git@github.com:Dev-Moura/e-commerce.git
cd e-commerce

# 2. Iniciar o Minikube
minikube start --memory=4096 --cpus=4

# 3. Build das imagens dentro do Minikube
make build-minikube

# 4. Deploy da infraestrutura e serviços
make k8s-deploy

# 5. Configurar hosts locais
make show-hosts
# Adicione as linhas ao seu /etc/hosts

# 6. Verificar pods
kubectl get pods -n infra
kubectl get pods -n apps
```

---

## Estrutura de Pastas Detalhada

```
e-commerce/
│
├── apps/                          # Código dos microsserviços
│   │
│   ├── auth-service/
│   │   ├── src/
│   │   │   ├── models/
│   │   │   │   └── User.ts        # Schema Mongoose do usuário
│   │   │   ├── server.ts          # Express app + rotas JWT
│   │   │   └── tests/
│   │   │       └── auth.test.ts   # 15 testes unitários
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── product-service/
│   │   ├── src/
│   │   │   ├── models/Product.ts
│   │   │   ├── rabbitmq.ts        # Publisher de eventos product.*
│   │   │   ├── server.ts
│   │   │   └── tests/product.test.ts
│   │   └── ...
│   │
│   ├── order-service/
│   │   ├── src/
│   │   │   ├── models/Order.ts
│   │   │   ├── rabbitmq.ts        # Publisher order.created + Consumer payment.*
│   │   │   ├── server.ts
│   │   │   └── tests/order.test.ts
│   │   └── ...
│   │
│   ├── payment-service/
│   │   ├── src/
│   │   │   ├── circuitBreaker.ts  # Implementação do padrão Circuit Breaker
│   │   │   ├── db.ts              # Conexão PostgreSQL
│   │   │   ├── rabbitmq.ts        # Consumer order.created + Publisher payment.*
│   │   │   ├── server.ts
│   │   │   └── tests/
│   │   │       ├── payment.test.ts
│   │   │       └── circuitBreaker.test.ts
│   │   └── ...
│   │
│   ├── search-worker/
│   │   ├── src/
│   │   │   └── worker.ts          # Consumer product.* → indexa no Elasticsearch
│   │   └── ...
│   │
│   └── frontend/
│       ├── src/
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── nginx.conf             # Config para servir SPA
│       └── Dockerfile
│
├── k8s/                           # Manifests Kubernetes
│   ├── infra/
│   │   ├── namespace.yaml         # Define namespaces infra e apps
│   │   ├── mongodb.yaml           # 3 instâncias MongoDB
│   │   ├── postgres.yaml          # PostgreSQL para pagamentos
│   │   ├── rabbitmq.yaml          # RabbitMQ com Management UI
│   │   └── elasticsearch.yaml     # Elasticsearch single-node
│   └── apps/
│       ├── auth-service.yaml
│       ├── product-service.yaml
│       ├── order-service.yaml
│       ├── payment-service.yaml
│       ├── search-worker.yaml
│       ├── frontend.yaml
│       └── ingress.yaml           # Roteamento NGINX por host
│
├── tests/
│   ├── infra/
│   │   └── k8s-health-check.sh    # Verifica saúde do cluster
│   └── run-all-tests.sh           # Executa unit tests + health checks
│
├── docs/                          # Esta documentação
│   ├── 01-visao-geral.md
│   ├── 02-tecnologias.md
│   ├── 03-decisoes-arquitetura.md
│   └── 04-guia-desenvolvimento.md
│
├── Makefile                       # Automação de comandos
└── README.md
```

---

## Fluxo de Desenvolvimento por Serviço

### Rodar um serviço localmente (sem Kubernetes)

```bash
cd apps/auth-service

# Instalar dependências
npm install

# Rodar em modo watch (hot reload)
npm run dev

# Variáveis de ambiente necessárias
MONGODB_URI=mongodb://localhost:27017/auth
JWT_SECRET=dev-secret-local
JWT_REFRESH_SECRET=dev-refresh-secret-local
```

### Rodar os testes

```bash
# Testes de um serviço específico
cd apps/auth-service && npm test

# Testes com coverage
npm run test:coverage

# Todos os testes (via Makefile)
make test-unit
```

### Adicionar uma nova rota

1. Defina a rota no `server.ts`
2. Crie o teste correspondente em `src/tests/`
3. Se a rota produz um evento, use o `publishEvent()` do `rabbitmq.ts`
4. Atualize o Dockerfile se necessário
5. Reconstrua a imagem: `eval $(minikube docker-env) && docker build -t <service>:latest ./apps/<service>`
6. Reinicie o deployment: `kubectl rollout restart deployment/<service> -n apps`

---

## Convenções de Código

### Naming de eventos RabbitMQ

```
Padrão: <domínio>.<ação>

Exemplos:
  product.created
  product.updated
  product.deleted
  order.created
  payment.succeeded
  payment.failed
```

### Estrutura de resposta da API

```typescript
// Sucesso
{ data: T, message?: string }

// Erro
{ error: string, details?: unknown }
```

### Variáveis de ambiente por serviço

| Variável | Serviço | Descrição |
|---|---|---|
| `MONGODB_URI` | auth, product, order | Connection string MongoDB |
| `RABBITMQ_URL` | product, order, payment, search | URL do broker |
| `JWT_SECRET` | auth | Chave para assinar access tokens |
| `JWT_REFRESH_SECRET` | auth | Chave para refresh tokens |
| `DATABASE_URL` | payment | Connection string PostgreSQL |
| `ELASTICSEARCH_URL` | search | URL do Elasticsearch |
| `PORT` | todos | Porta do servidor HTTP |

---

## Debugging no Kubernetes

```bash
# Ver logs de um serviço
kubectl logs -f deployment/auth-service -n apps

# Entrar no container
kubectl exec -it deployment/auth-service -n apps -- sh

# Ver eventos do cluster (útil para CrashLoopBackOff)
kubectl describe pod <pod-name> -n apps

# Verificar se um serviço consegue se comunicar
kubectl exec -it deployment/order-service -n apps -- \
  curl http://rabbitmq-service.infra:15672/api/overview \
  -u guest:guest

# Port-forward para acessar um serviço diretamente
kubectl port-forward service/auth-service 3001:3001 -n apps
```

---

## Testes de Infraestrutura

O script `tests/infra/k8s-health-check.sh` verifica:

1. **Pods rodando** — todos os pods em `infra` e `apps` estão no status `Running`
2. **Serviços expostos** — todos os Services estão com endpoints ativos
3. **Ingress funcionando** — rotas do NGINX respondem corretamente
4. **Conectividade** — serviços conseguem se alcançar dentro do cluster

```bash
# Rodar verificação de infraestrutura
make test-infra
```

---

## Branches e Fluxo de Git

```
main          ← Branch principal, código estável
  │
  ├── infra   ← Manifests K8s, Makefile, scripts de teste
  ├── auth    ← auth-service
  ├── micro   ← product, order, payment, search-worker
  └── app     ← frontend React
```

**Workflow sugerido:**

```bash
# Trabalhar em uma feature
git checkout -b feature/nome-da-feature

# Ao finalizar, fazer merge na branch correspondente
git checkout micro
git merge feature/nome-da-feature

# Push
git push origin micro
```

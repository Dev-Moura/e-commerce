# 🏛️ Decisões de Arquitetura (ADRs)

ADR — *Architecture Decision Record* — é um documento que registra **por que** uma decisão foi tomada, não apenas **o que** foi decidido. Isso é especialmente valioso quando a equipe cresce ou quando precisamos rever uma decisão meses depois.

---

## ADR-001: Adoção de Microsserviços em vez de Monolito Modular

**Status:** Aceito

**Contexto:**
O projeto é uma plataforma de e-commerce com domínios bem distintos: autenticação, catálogo, pedidos e pagamentos. Cada domínio tem requisitos de escala, banco de dados e criticidade diferentes.

**Decisão:**
Implementar cada domínio como um microsserviço independente com seu próprio banco de dados.

**Consequências positivas:**
- Escala independente (ex: pagamentos pode ter mais réplicas no Black Friday)
- Falha isolada (um serviço fora não derruba os outros)
- Deploy independente por equipe/domínio

**Consequências negativas e mitigações:**
- Complexidade operacional → mitigado por Kubernetes e Makefile
- Latência de rede entre serviços → mitigado por comunicação assíncrona via RabbitMQ
- Testes de integração mais complexos → mitigado por testes unitários com mocks robustos

---

## ADR-002: Topic Exchange no RabbitMQ em vez de Direct Exchange

**Status:** Aceito

**Contexto:**
Precisamos rotear eventos entre múltiplos produtores e consumidores. O padrão mais simples seria um Direct Exchange (chave exata).

**Decisão:**
Usar Topic Exchange com padrões de routing key como `product.*`, `order.*`, `payment.*`.

**Motivação:**
```
Direct Exchange:
  "product.created" → search-worker ✅
  "product.updated" → ?  (precisaria criar nova binding)

Topic Exchange:
  "product.*" → search-worker ✅ (captura created E updated automaticamente)
  "payment.*" → order-service  ✅ (captura succeeded E failed)
```

O Topic Exchange permite adicionar novos tipos de evento (ex: `product.deleted`) sem alterar as bindings existentes.

**Consequências:**
- Maior flexibilidade para evolução do sistema
- Pequeno custo adicional de matching de padrão (negligenciável)

---

## ADR-003: PostgreSQL isolado para pagamentos, MongoDB para o restante

**Status:** Aceito

**Contexto:**
Uma abordagem simples seria usar MongoDB para todos os serviços. Por que adicionar a complexidade de um segundo banco?

**Decisão:**
MongoDB para dados de negócio com schema variável (produtos, pedidos, usuários) e PostgreSQL exclusivamente para transações financeiras.

**Justificativa:**

O domínio de pagamentos tem características únicas:
1. **Atomicidade é obrigatória** — débito e registro de liquidação devem ser uma única transação
2. **Auditoria regulatória** — cada centavo deve ser rastreável com integridade garantida
3. **Idempotência** — o mesmo pagamento não pode ser processado duas vezes

MongoDB suporta transações multi-documento desde a versão 4.0, mas:
- Requer replica set (overhead em ambiente local)
- A API transacional é menos madura que o PostgreSQL
- O ecossistema de ferramentas financeiras (ex: pg-logical, Slony) não existe para Mongo

**Regra prática:** Se a operação envolve dinheiro → PostgreSQL.

---

## ADR-004: Circuit Breaker implementado do zero

**Status:** Aceito

**Contexto:**
O payment-service chama um gateway de pagamento externo. Bibliotecas como `opossum` ou `cockatiel` já implementam circuit breaker para Node.js.

**Decisão:**
Implementar o Circuit Breaker manualmente.

**Motivação:**
1. **Dependência zero** — uma biblioteca a menos para atualizar, auditar e que pode ser descontinuada
2. **Controle total** — podemos adicionar logging, métricas e comportamentos customizados sem monkey-patching
3. **Demonstração de domínio** — entender o padrão, não apenas importá-lo
4. **Simplicidade** — a implementação completa cabe em 80 linhas de TypeScript

```typescript
// A máquina de estados é direta:
// CLOSED → (n falhas) → OPEN → (timeout) → HALF-OPEN → (sucesso) → CLOSED
//                                                      → (falha)  → OPEN
```

**Quando revisitar:**
Se precisarmos de métricas Prometheus, fallback strategies ou suporte a bulkheads, avaliar `opossum`.

---

## ADR-005: Autenticação Stateless com JWT

**Status:** Aceito

**Contexto:**
Alternativas para autenticação em microsserviços:
1. **Sessions no Redis** — stateful, requer infraestrutura adicional
2. **JWT stateless** — qualquer serviço valida sem consultar banco
3. **OAuth2 externo** (Auth0, Keycloak) — robusto mas adiciona dependência externa

**Decisão:**
JWT com Access Token (15min) + Refresh Token (7 dias).

**Por que não Redis Sessions?**
Em uma arquitetura de microsserviços, o auth-service não seria o único validando tokens. O order-service, product-service etc. precisariam validar o token do usuário. Com sessões no Redis, todos precisariam acessar o mesmo Redis — criando um ponto único de falha e acoplamento.

Com JWT, a validação é **local e criptográfica** — qualquer serviço com a chave pública pode validar, sem rede.

**Por que não OAuth2 externo?**
Para um projeto de portfólio e aprendizado, implementar o próprio sistema de autenticação demonstra domínio do mecanismo. Em produção real, Auth0 ou Keycloak seriam mais adequados.

**Risco mitigado:**
JWT roubado não pode ser revogado antes do vencimento. Mitigação: access token de curtíssima duração (15min). Se vazar, expira rapidamente.

---

## ADR-006: Vite em vez de Create React App

**Status:** Aceito

**Contexto:**
Create React App (CRA) é o setup padrão historicamente, mas foi descontinuado pela equipe do React em 2023.

**Decisão:**
Vite com plugin React.

**Comparação em números:**
```
CRA (webpack):
  - Instalação inicial: ~200MB, ~2 minutos
  - Cold start dev server: ~30 segundos
  - Hot Module Replacement: 2-5 segundos

Vite (esbuild):
  - Instalação inicial: ~50MB, ~20 segundos
  - Cold start dev server: ~300ms
  - Hot Module Replacement: <50ms
```

Vite usa **esbuild** (escrito em Go) para pré-bundlar dependências — 10-100x mais rápido que webpack — e serve o código da aplicação como ES Modules nativos do browser durante o desenvolvimento.

---

## ADR-007: Namespaces Kubernetes: `infra` e `apps`

**Status:** Aceito

**Contexto:**
Poderíamos colocar tudo no namespace `default` para simplificar.

**Decisão:**
Separar em dois namespaces: `infra` (bancos e mensageria) e `apps` (microsserviços).

**Benefícios:**
1. **Isolamento de rede** — recursos de infraestrutura não são acessíveis diretamente do exterior
2. **Políticas de recurso separadas** — ResourceQuotas diferentes para infra e apps
3. **RBAC** — permissões diferentes para quem opera infraestrutura vs. quem faz deploy de apps
4. **Clareza operacional** — `kubectl get pods -n infra` mostra só os bancos

**Como os apps acessam a infra:**
```
# DNS interno do Kubernetes
mongodb-service.infra.svc.cluster.local:27017
# Simplificado para:
mongodb-service.infra:27017
```

A separação de namespaces simula o isolamento que empresas utilizam para separar times de plataforma (SRE/Infra) de times de produto.

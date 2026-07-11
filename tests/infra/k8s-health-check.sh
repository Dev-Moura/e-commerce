#!/usr/bin/env bash
# =============================================================================
# tests/infra/k8s-health-check.sh
# Testa se toda a infraestrutura Kubernetes do e-commerce está saudável
# Uso: bash tests/infra/k8s-health-check.sh
# =============================================================================

set -euo pipefail

# ── Cores ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

# ── Helpers ───────────────────────────────────────────────────────────────────
pass() { echo -e "  ${GREEN}✅ PASS${NC} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}❌ FAIL${NC} $1"; ((FAIL++)); }
skip() { echo -e "  ${YELLOW}⏭  SKIP${NC} $1"; ((SKIP++)); }
section() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }

# ── Pré-verificação ───────────────────────────────────────────────────────────
section "Pré-verificação de ferramentas"

if ! command -v kubectl &>/dev/null; then fail "kubectl não encontrado"; exit 1; fi
if ! command -v minikube &>/dev/null; then fail "minikube não encontrado"; exit 1; fi
pass "kubectl disponível"
pass "minikube disponível"

# ── Minikube ──────────────────────────────────────────────────────────────────
section "Minikube"

MINIKUBE_STATUS=$(minikube status --format '{{.Host}}' 2>/dev/null || echo "Stopped")
if [[ "$MINIKUBE_STATUS" == "Running" ]]; then
  pass "Minikube está rodando"
else
  fail "Minikube não está rodando (status: $MINIKUBE_STATUS)"
fi

MINIKUBE_K8S=$(minikube status --format '{{.Kubelet}}' 2>/dev/null || echo "Stopped")
if [[ "$MINIKUBE_K8S" == "Running" ]]; then
  pass "Kubelet está ativo"
else
  fail "Kubelet não está ativo"
fi

# ── Namespaces ────────────────────────────────────────────────────────────────
section "Namespaces"

for ns in infra apps; do
  if kubectl get namespace "$ns" &>/dev/null; then
    pass "Namespace '$ns' existe"
  else
    fail "Namespace '$ns' não existe"
  fi
done

# ── Infra: Pods ───────────────────────────────────────────────────────────────
section "Pods de Infraestrutura (namespace: infra)"

INFRA_SERVICES=("mongodb" "postgres" "rabbitmq" "elasticsearch")

for svc in "${INFRA_SERVICES[@]}"; do
  POD_STATUS=$(kubectl get pods -n infra -l "app=$svc" \
    --no-headers -o custom-columns=":status.phase" 2>/dev/null | head -1)
  POD_READY=$(kubectl get pods -n infra -l "app=$svc" \
    --no-headers -o custom-columns=":status.containerStatuses[0].ready" 2>/dev/null | head -1)

  if [[ "$POD_STATUS" == "Running" && "$POD_READY" == "true" ]]; then
    pass "Pod '$svc' está Running e Ready"
  elif [[ "$POD_STATUS" == "Running" ]]; then
    fail "Pod '$svc' está Running mas não está Ready"
  else
    fail "Pod '$svc' não está Running (status: ${POD_STATUS:-N/A})"
  fi
done

# ── Apps: Pods ────────────────────────────────────────────────────────────────
section "Pods de Aplicação (namespace: apps)"

APP_SERVICES=("auth-service" "product-service" "order-service" "payment-service" "search-worker" "frontend")

for svc in "${APP_SERVICES[@]}"; do
  POD_STATUS=$(kubectl get pods -n apps -l "app=$svc" \
    --no-headers -o custom-columns=":status.phase" 2>/dev/null | head -1)
  POD_READY=$(kubectl get pods -n apps -l "app=$svc" \
    --no-headers -o custom-columns=":status.containerStatuses[0].ready" 2>/dev/null | head -1)

  if [[ "$POD_STATUS" == "Running" && "$POD_READY" == "true" ]]; then
    pass "Pod '$svc' está Running e Ready"
  elif [[ "$POD_STATUS" == "Running" ]]; then
    fail "Pod '$svc' está Running mas não está Ready"
  else
    fail "Pod '$svc' não está Running (status: ${POD_STATUS:-N/A})"
  fi
done

# ── Services ──────────────────────────────────────────────────────────────────
section "Kubernetes Services"

INFRA_SVC=("mongodb-service" "postgres-service" "rabbitmq-service" "elasticsearch-service")
for svc in "${INFRA_SVC[@]}"; do
  if kubectl get svc -n infra "$svc" &>/dev/null; then
    pass "Service '$svc' existe no namespace infra"
  else
    fail "Service '$svc' não encontrado no namespace infra"
  fi
done

APP_SVC=("auth-service" "product-service" "order-service" "payment-service" "frontend")
for svc in "${APP_SVC[@]}"; do
  if kubectl get svc -n apps "$svc" &>/dev/null; then
    pass "Service '$svc' existe no namespace apps"
  else
    fail "Service '$svc' não encontrado no namespace apps"
  fi
done

# ── Ingress ───────────────────────────────────────────────────────────────────
section "Ingress"

INGRESSES=("ecommerce-frontend-ingress" "ecommerce-api-explicit-ingress")
for ing in "${INGRESSES[@]}"; do
  if kubectl get ingress -n apps "$ing" &>/dev/null; then
    pass "Ingress '$ing' existe"
  else
    fail "Ingress '$ing' não encontrado"
  fi
done

INGRESS_ADDON=$(minikube addons list | grep "^| ingress " | awk '{print $4}')
if [[ "$INGRESS_ADDON" == "enabled" ]]; then
  pass "Addon Ingress está habilitado"
else
  fail "Addon Ingress está desabilitado (execute: minikube addons enable ingress)"
fi

# ── Healthcheck HTTP dos serviços via port-forward ────────────────────────────
section "Healthcheck HTTP dos Serviços (via kubectl exec)"

declare -A SERVICE_PORTS=(
  ["auth-service"]="3000"
  ["product-service"]="3001"
  ["order-service"]="3002"
  ["payment-service"]="3003"
  ["frontend"]="80"
)

for svc in "${!SERVICE_PORTS[@]}"; do
  PORT="${SERVICE_PORTS[$svc]}"
  POD=$(kubectl get pods -n apps -l "app=$svc" --no-headers -o custom-columns=":metadata.name" 2>/dev/null | head -1)

  if [[ -z "$POD" ]]; then
    skip "Sem pod para '$svc' — pulando healthcheck HTTP"
    continue
  fi

  # Testa o healthcheck internamente no pod
  if [[ "$svc" == "frontend" ]]; then
    HEALTH=$(kubectl exec -n apps "$POD" -- wget -qO- "http://localhost:$PORT/" 2>/dev/null | head -c 50 || echo "")
    if [[ -n "$HEALTH" ]]; then
      pass "Frontend responde em localhost:$PORT"
    else
      fail "Frontend não respondeu em localhost:$PORT"
    fi
  else
    HEALTH=$(kubectl exec -n apps "$POD" -- wget -qO- "http://localhost:$PORT/health" 2>/dev/null || echo "")
    if echo "$HEALTH" | grep -q '"status":"OK"'; then
      pass "Serviço '$svc' respondeu OK no /health"
    else
      fail "Serviço '$svc' não retornou status OK no /health (resposta: ${HEALTH:0:100})"
    fi
  fi
done

# ── Verificação de CrashLoopBackOff ──────────────────────────────────────────
section "Detecção de Pods com Falha"

CRASH_PODS=$(kubectl get pods -n apps --no-headers 2>/dev/null | grep -E "CrashLoopBackOff|Error|OOMKilled|Pending" || true)
if [[ -z "$CRASH_PODS" ]]; then
  pass "Nenhum pod em CrashLoopBackOff, Error ou Pending no namespace apps"
else
  fail "Pods com problema no namespace apps:\n$CRASH_PODS"
fi

CRASH_INFRA=$(kubectl get pods -n infra --no-headers 2>/dev/null | grep -E "CrashLoopBackOff|Error|OOMKilled|Pending" || true)
if [[ -z "$CRASH_INFRA" ]]; then
  pass "Nenhum pod com falha no namespace infra"
else
  fail "Pods com problema no namespace infra:\n$CRASH_INFRA"
fi

# ── Resumo ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}  RESULTADO DOS TESTES DE INFRA K8S${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "  ${GREEN}✅ Passou: $PASS${NC}"
echo -e "  ${RED}❌ Falhou: $FAIL${NC}"
echo -e "  ${YELLOW}⏭  Pulou:  $SKIP${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "\n${RED}${BOLD}⚠️  Alguns testes falharam. Verifique os logs acima.${NC}"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}🎉 Toda a infraestrutura está saudável!${NC}"
  exit 0
fi

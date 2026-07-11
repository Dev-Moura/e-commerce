#!/usr/bin/env bash
# =============================================================================
# tests/run-all-tests.sh
# Executa TODOS os testes do projeto: unit tests + infra K8s
# Uso: bash tests/run-all-tests.sh [--skip-infra] [--skip-unit]
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

SKIP_INFRA=false
SKIP_UNIT=false

for arg in "$@"; do
  [[ "$arg" == "--skip-infra" ]] && SKIP_INFRA=true
  [[ "$arg" == "--skip-unit" ]] && SKIP_UNIT=true
done

TOTAL_PASS=0; TOTAL_FAIL=0
SERVICES=("auth-service" "product-service" "order-service" "payment-service")

section() { echo -e "\n${BOLD}${BLUE}════════════════════════════════════════${NC}"; echo -e "${BOLD}${BLUE}  $1${NC}"; echo -e "${BOLD}${BLUE}════════════════════════════════════════${NC}"; }

# ── Unit Tests ────────────────────────────────────────────────────────────────
if [[ "$SKIP_UNIT" == false ]]; then
  section "🧪 UNIT TESTS — Microsserviços"
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"

  for svc in "${SERVICES[@]}"; do
    echo -e "\n${BOLD}▶ Testando: $svc${NC}"
    SVC_PATH="$ROOT/apps/$svc"

    # Instala dependências se necessário
    if [[ ! -d "$SVC_PATH/node_modules" ]]; then
      echo -e "  ${YELLOW}📦 Instalando dependências...${NC}"
      (cd "$SVC_PATH" && npm install --silent)
    fi

    if (cd "$SVC_PATH" && npm test -- --reporter=verbose 2>&1); then
      echo -e "  ${GREEN}✅ $svc — PASSOU${NC}"
      ((TOTAL_PASS++))
    else
      echo -e "  ${RED}❌ $svc — FALHOU${NC}"
      ((TOTAL_FAIL++))
    fi
  done
fi

# ── Infra Tests ───────────────────────────────────────────────────────────────
if [[ "$SKIP_INFRA" == false ]]; then
  section "🏗️  INFRA TESTS — Kubernetes"
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

  if bash "$SCRIPT_DIR/infra/k8s-health-check.sh"; then
    echo -e "\n  ${GREEN}✅ Infra K8s — PASSOU${NC}"
    ((TOTAL_PASS++))
  else
    echo -e "\n  ${RED}❌ Infra K8s — FALHOU${NC}"
    ((TOTAL_FAIL++))
  fi
fi

# ── Resumo Final ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║      RESULTADO FINAL DOS TESTES      ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════╣${NC}"
echo -e "${BOLD}║  ${GREEN}✅ Passou: $TOTAL_PASS suítes${NC}$(printf '%*s' $((30 - ${#TOTAL_PASS})) '')${BOLD}║${NC}"
echo -e "${BOLD}║  ${RED}❌ Falhou: $TOTAL_FAIL suítes${NC}$(printf '%*s' $((30 - ${#TOTAL_FAIL})) '')${BOLD}║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"

[[ "$TOTAL_FAIL" -gt 0 ]] && exit 1 || exit 0

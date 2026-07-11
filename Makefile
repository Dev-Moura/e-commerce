.PHONY: help build-apps k8s-deploy k8s-undeploy minikube-env show-hosts test test-unit test-infra install-test-deps

# Ajuda padrão
help:
	@echo "Comandos disponíveis:"
	@echo "  make build-apps        - Compila e gera as imagens Docker locais no daemon do seu host"
	@echo "  make build-minikube    - Configura o shell para o Minikube e constrói as imagens direto nele"
	@echo "  make k8s-deploy        - Aplica todos os manifests YAML na ordem correta no Minikube"
	@echo "  make k8s-undeploy      - Remove todos os recursos do Kubernetes (infra e apps)"
	@echo "  make show-hosts        - Exibe a configuração necessária para o arquivo /etc/hosts"
	@echo "  make install-test-deps - Instala dependências de teste em todos os serviços"
	@echo "  make test-unit         - Executa testes unitários de todos os microsserviços"
	@echo "  make test-infra        - Executa testes de saúde da infraestrutura Kubernetes"
	@echo "  make test              - Executa TODOS os testes (unit + infra)"

# Compila as imagens Docker localmente
build-apps:
	@echo "🔨 Construindo imagens Docker no daemon local..."
	docker build -t auth-service:latest ./apps/auth-service
	docker build -t product-service:latest ./apps/product-service
	docker build -t search-worker:latest ./apps/search-worker
	docker build -t order-service:latest ./apps/order-service
	docker build -t payment-service:latest ./apps/payment-service
	docker build -t frontend:latest ./apps/frontend
	@echo "✅ Imagens construídas com sucesso!"

# Compila as imagens Docker dentro do Minikube (para evitar pull externo)
build-minikube:
	@echo "🔨 Construindo imagens Docker dentro do ambiente Minikube..."
	@echo "Certifique-se de que o Minikube está rodando."
	bash -c "eval \$$(minikube docker-env) && \
	docker build -t auth-service:latest ./apps/auth-service && \
	docker build -t product-service:latest ./apps/product-service && \
	docker build -t search-worker:latest ./apps/search-worker && \
	docker build -t order-service:latest ./apps/order-service && \
	docker build -t payment-service:latest ./apps/payment-service && \
	docker build -t frontend:latest ./apps/frontend"
	@echo "✅ Imagens construídas com sucesso dentro do Minikube!"

# Implanta a infraestrutura e os microsserviços no Minikube
k8s-deploy:
	@echo "🚀 Criando Namespaces e aplicando Infraestrutura base (infra)..."
	kubectl apply -f k8s/infra/namespace.yaml
	kubectl apply -f k8s/infra/mongodb.yaml
	kubectl apply -f k8s/infra/postgres.yaml
	kubectl apply -f k8s/infra/elasticsearch.yaml
	kubectl apply -f k8s/infra/rabbitmq.yaml
	@echo "⏳ Aguardando serviços de infraestrutura inicializarem (15s)..."
	sleep 15
	@echo "🚀 Aplicando Microsserviços e Ingress (apps)..."
	kubectl apply -f k8s/apps/auth-service.yaml
	kubectl apply -f k8s/apps/product-service.yaml
	kubectl apply -f k8s/apps/search-worker.yaml
	kubectl apply -f k8s/apps/order-service.yaml
	kubectl apply -f k8s/apps/payment-service.yaml
	kubectl apply -f k8s/apps/frontend.yaml
	kubectl apply -f k8s/apps/ingress.yaml
	@echo "✅ Implantação concluída! Execute 'kubectl get pods -n apps' para verificar."

# Remove toda a implantação
k8s-undeploy:
	@echo "🧹 Removendo Ingress e Microsserviços (apps)..."
	kubectl delete -f k8s/apps/ || true
	@echo "🧹 Removendo infraestrutura e bancos (infra)..."
	kubectl delete -f k8s/infra/ || true
	@echo "✅ Toda a infraestrutura foi desativada!"

# Exibe as entradas que o usuário deve adicionar ao arquivo hosts
show-hosts:
	@echo "Cole as linhas abaixo no seu arquivo /etc/hosts local:"
	@echo "--------------------------------------------------------"
	@echo "$$(minikube ip || echo 'IP_DO_MINIKUBE')   ecommerce.local"
	@echo "$$(minikube ip || echo 'IP_DO_MINIKUBE')   api.ecommerce.local"
	@echo "--------------------------------------------------------"

# Instala dependências de teste em todos os serviços
install-test-deps:
	@echo "📦 Instalando dependências de teste..."
	cd apps/auth-service    && npm install
	cd apps/product-service && npm install
	cd apps/order-service   && npm install
	cd apps/payment-service && npm install
	@echo "✅ Dependências instaladas!"

# Executa unit tests de todos os microsserviços
test-unit: install-test-deps
	@echo "🧪 Executando unit tests..."
	cd apps/auth-service    && npm test
	cd apps/product-service && npm test
	cd apps/order-service   && npm test
	cd apps/payment-service && npm test
	@echo "✅ Unit tests concluídos!"

# Executa testes de infraestrutura Kubernetes
test-infra:
	@echo "🏗️  Executando testes de infraestrutura K8s..."
	chmod +x tests/infra/k8s-health-check.sh
	bash tests/infra/k8s-health-check.sh

# Executa TODOS os testes
test:
	@echo "🚀 Executando todos os testes..."
	chmod +x tests/run-all-tests.sh
	bash tests/run-all-tests.sh

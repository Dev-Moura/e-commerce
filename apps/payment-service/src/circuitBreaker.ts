type CircuitState = 'CLOSED' | 'OPEN' | 'HALF-OPEN';

export class CircuitBreaker<T, Args extends any[]> {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  
  // Configurações padrão
  private failureThreshold = 3;         // Abre após 3 falhas
  private recoveryTimeout = 10000;       // Aguarda 10 segundos em OPEN
  private halfOpenSuccessThreshold = 1;  // Requer 1 sucesso para fechar

  constructor(
    private protectedFn: (...args: Args) => Promise<T>,
    options?: {
      failureThreshold?: number;
      recoveryTimeout?: number;
    }
  ) {
    if (options?.failureThreshold) this.failureThreshold = options.failureThreshold;
    if (options?.recoveryTimeout) this.recoveryTimeout = options.recoveryTimeout;
  }

  public getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  private updateState() {
    if (this.state === 'OPEN' && this.lastFailureTime) {
      const now = Date.now();
      if (now - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'HALF-OPEN';
        console.warn(`🔄 Circuit Breaker alterado para HALF-OPEN. Testando serviço...`);
      }
    }
  }

  public async execute(...args: Args): Promise<T> {
    this.updateState();

    if (this.state === 'OPEN') {
      throw new Error('Circuit Breaker is OPEN. Request rejected to prevent system overload.');
    }

    try {
      const result = await this.protectedFn(...args);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  private onSuccess() {
    if (this.state === 'HALF-OPEN') {
      this.state = 'CLOSED';
      this.failureCount = 0;
      this.lastFailureTime = null;
      console.log('✅ Circuit Breaker FECHADO. Serviço restabelecido.');
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(error: any) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    console.error(`⚠️ Falha detectada (${this.failureCount}/${this.failureThreshold}):`, error.message || error);

    if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.error('🚨 Circuit Breaker ABERTO! Redirecionando ou rejeitando tráfego.');
    } else if (this.state === 'HALF-OPEN') {
      this.state = 'OPEN';
      console.error('🚨 Teste em HALF-OPEN falhou. Circuit Breaker retorna a ABERTO.');
    }
  }
}

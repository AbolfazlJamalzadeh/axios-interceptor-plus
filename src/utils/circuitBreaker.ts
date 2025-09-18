import { AxiosError } from 'axios';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number; // Number of failures before opening
  successThreshold: number; // Number of successes needed to close from half-open
  timeout: number; // Time to wait before trying half-open state
  resetTimeout: number; // Time to wait before resetting failure count
  monitoringPeriod: number; // Time window for monitoring failures
  errorFilter?: (error: AxiosError) => boolean; // Which errors should count as failures
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  nextAttemptTime?: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  failureRate: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private nextAttemptTime?: number;
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private failureHistory: number[] = [];
  private config: CircuitBreakerConfig;
  private resetTimer?: NodeJS.Timeout;
  private monitoringTimer?: NodeJS.Timeout;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
    this.startMonitoring();
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.config.enabled) {
      return operation();
    }

    this.totalRequests++;

    // Check if circuit should allow the request
    if (!this.canExecute()) {
      throw new Error(`Circuit breaker is ${this.state}. Request rejected.`);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as AxiosError);
      throw error;
    }
  }

  canExecute(): boolean {
    if (!this.config.enabled) {
      return true;
    }

    switch (this.state) {
      case 'closed':
        return true;
      
      case 'open':
        if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
          this.state = 'half-open';
          this.successCount = 0;
          return true;
        }
        return false;
      
      case 'half-open':
        return true;
      
      default:
        return true;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      failureRate: this.totalRequests > 0 ? this.totalFailures / this.totalRequests : 0,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.nextAttemptTime = undefined;
    this.failureHistory = [];
    
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }

  forceOpen(): void {
    this.state = 'open';
    this.nextAttemptTime = Date.now() + this.config.timeout;
  }

  forceClose(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = undefined;
  }

  forceHalfOpen(): void {
    this.state = 'half-open';
    this.successCount = 0;
    this.nextAttemptTime = undefined;
  }

  // Private methods
  private onSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();
    
    if (this.state === 'half-open') {
      this.successCount++;
      
      if (this.successCount >= this.config.successThreshold) {
        this.close();
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  private onFailure(error: AxiosError): void {
    // Check if this error should count as a failure
    if (this.config.errorFilter && !this.config.errorFilter(error)) {
      return;
    }

    this.totalFailures++;
    this.lastFailureTime = Date.now();
    this.failureCount++;
    
    // Add to failure history for monitoring
    this.failureHistory.push(Date.now());
    
    if (this.state === 'closed') {
      if (this.failureCount >= this.config.failureThreshold) {
        this.open();
      }
    } else if (this.state === 'half-open') {
      // Any failure in half-open state should open the circuit
      this.open();
    }
  }

  private open(): void {
    this.state = 'open';
    this.nextAttemptTime = Date.now() + this.config.timeout;
    
    // Clear reset timer if it exists
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    
    // Set timer to reset failure count
    this.resetTimer = setTimeout(() => {
      this.failureCount = 0;
    }, this.config.resetTimeout);
  }

  private close(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = undefined;
    
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }

  private startMonitoring(): void {
    if (!this.config.enabled) {
      return;
    }

    this.monitoringTimer = setInterval(() => {
      this.cleanupFailureHistory();
    }, this.config.monitoringPeriod);
  }

  private cleanupFailureHistory(): void {
    const cutoff = Date.now() - this.config.monitoringPeriod;
    this.failureHistory = this.failureHistory.filter(timestamp => timestamp > cutoff);
  }

  updateConfig(newConfig: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Restart monitoring if period changed
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }
    this.startMonitoring();
  }

  destroy(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }
  }
}

// Circuit Breaker Manager for multiple services
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private defaultConfig: CircuitBreakerConfig;

  constructor(defaultConfig: CircuitBreakerConfig) {
    this.defaultConfig = defaultConfig;
  }

  getBreaker(serviceName: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(serviceName)) {
      const breakerConfig = { ...this.defaultConfig, ...config };
      this.breakers.set(serviceName, new CircuitBreaker(breakerConfig));
    }
    return this.breakers.get(serviceName)!;
  }

  async execute<T>(
    serviceName: string,
    operation: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>
  ): Promise<T> {
    const breaker = this.getBreaker(serviceName, config);
    return breaker.execute(operation);
  }

  getStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  forceOpenAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.forceOpen();
    }
  }

  forceCloseAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.forceClose();
    }
  }

  destroy(): void {
    for (const breaker of this.breakers.values()) {
      breaker.destroy();
    }
    this.breakers.clear();
  }
}

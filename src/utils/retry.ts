import { AxiosError, AxiosRequestConfig } from 'axios';
import { RetryConfig } from '../types';

export class RetryHandler {
  private config: RetryConfig;

  constructor(config: RetryConfig) {
    this.config = config;
  }

  async executeWithRetry<T>(
    requestFn: () => Promise<T>,
    originalConfig?: AxiosRequestConfig
  ): Promise<T> {
    if (!this.config.enabled) {
      return requestFn();
    }

    let lastError: AxiosError;
    
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error as AxiosError;
        
        // Check if we should retry this error
        if (attempt === this.config.maxRetries || !this.shouldRetry(lastError)) {
          throw lastError;
        }

        // Calculate delay for next retry
        const delay = this.calculateDelay(attempt);
        
        // Wait before retrying
        await this.delay(delay);
      }
    }

    throw lastError!;
  }

  private shouldRetry(error: AxiosError): boolean {
    if (this.config.retryCondition) {
      return this.config.retryCondition(error);
    }

    // Default retry conditions
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return true; // Timeout errors
    }

    if (error.response) {
      const status = error.response.status;
      // Retry on server errors (5xx) and some client errors
      return status >= 500 || status === 408 || status === 429;
    }

    // Retry on network errors
    return !error.response;
  }

  private calculateDelay(attempt: number): number {
    if (this.config.retryDelayFunction) {
      return this.config.retryDelayFunction(attempt);
    }

    // Exponential backoff with jitter
    const baseDelay = this.config.retryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    
    return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  updateConfig(newConfig: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

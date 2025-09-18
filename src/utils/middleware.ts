import { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

export interface MiddlewareContext {
  requestId: string;
  serviceName?: string;
  startTime: number;
  metadata: Record<string, any>;
}

export interface MiddlewareRequest {
  config: AxiosRequestConfig;
  context: MiddlewareContext;
}

export interface MiddlewareResponse {
  response: AxiosResponse;
  context: MiddlewareContext;
  config?: AxiosRequestConfig;
}

export interface MiddlewareError {
  error: AxiosError;
  context: MiddlewareContext;
}

export type MiddlewareFunction = (
  request: MiddlewareRequest,
  next: () => Promise<MiddlewareResponse>
) => Promise<MiddlewareResponse>;

export type ErrorMiddlewareFunction = (
  error: MiddlewareError,
  next: () => Promise<MiddlewareResponse>
) => Promise<MiddlewareResponse>;

export interface MiddlewareConfig {
  enabled: boolean;
  maxMiddlewares: number;
  timeout: number;
}

export class MiddlewareManager {
  private requestMiddlewares: MiddlewareFunction[] = [];
  private responseMiddlewares: MiddlewareFunction[] = [];
  private errorMiddlewares: ErrorMiddlewareFunction[] = [];
  private config: MiddlewareConfig;

  constructor(config: MiddlewareConfig) {
    this.config = config;
  }

  // Request middleware (runs before request)
  useRequest(middleware: MiddlewareFunction): () => void {
    if (!this.config.enabled) {
      return () => {};
    }

    if (this.requestMiddlewares.length >= this.config.maxMiddlewares) {
      console.warn(`Maximum request middlewares (${this.config.maxMiddlewares}) reached`);
      return () => {};
    }

    this.requestMiddlewares.push(middleware);

    return () => {
      const index = this.requestMiddlewares.indexOf(middleware);
      if (index > -1) {
        this.requestMiddlewares.splice(index, 1);
      }
    };
  }

  // Response middleware (runs after successful response)
  useResponse(middleware: MiddlewareFunction): () => void {
    if (!this.config.enabled) {
      return () => {};
    }

    if (this.responseMiddlewares.length >= this.config.maxMiddlewares) {
      console.warn(`Maximum response middlewares (${this.config.maxMiddlewares}) reached`);
      return () => {};
    }

    this.responseMiddlewares.push(middleware);

    return () => {
      const index = this.responseMiddlewares.indexOf(middleware);
      if (index > -1) {
        this.responseMiddlewares.splice(index, 1);
      }
    };
  }

  // Error middleware (runs after error)
  useError(middleware: ErrorMiddlewareFunction): () => void {
    if (!this.config.enabled) {
      return () => {};
    }

    if (this.errorMiddlewares.length >= this.config.maxMiddlewares) {
      console.warn(`Maximum error middlewares (${this.config.maxMiddlewares}) reached`);
      return () => {};
    }

    this.errorMiddlewares.push(middleware);

    return () => {
      const index = this.errorMiddlewares.indexOf(middleware);
      if (index > -1) {
        this.errorMiddlewares.splice(index, 1);
      }
    };
  }

  // Execute all middlewares
  async executeRequestMiddlewares(
    config: AxiosRequestConfig,
    context: MiddlewareContext
  ): Promise<AxiosRequestConfig> {
    if (!this.config.enabled || this.requestMiddlewares.length === 0) {
      return config;
    }

    let currentConfig = config;
    let currentContext = context;

    for (const middleware of this.requestMiddlewares) {
      try {
        const result = await this.executeWithTimeout(
          () => middleware(
            { config: currentConfig, context: currentContext },
            async () => ({ response: {} as AxiosResponse, context: currentContext })
          ),
          this.config.timeout
        );
        
        currentConfig = result.config || currentConfig;
        currentContext = result.context;
      } catch (error) {
        console.error('Error in request middleware:', error);
        // Continue with other middlewares
      }
    }

    return currentConfig;
  }

  async executeResponseMiddlewares(
    response: AxiosResponse,
    context: MiddlewareContext
  ): Promise<AxiosResponse> {
    if (!this.config.enabled || this.responseMiddlewares.length === 0) {
      return response;
    }

    let currentResponse = response;
    let currentContext = context;

    for (const middleware of this.responseMiddlewares) {
      try {
        const result = await this.executeWithTimeout(
          () => middleware(
            { config: response.config, context: currentContext },
            async () => ({ response: currentResponse, context: currentContext })
          ),
          this.config.timeout
        );
        
        currentResponse = result.response;
        currentContext = result.context;
      } catch (error) {
        console.error('Error in response middleware:', error);
        // Continue with other middlewares
      }
    }

    return currentResponse;
  }

  async executeErrorMiddlewares(
    error: AxiosError,
    context: MiddlewareContext
  ): Promise<AxiosResponse> {
    if (!this.config.enabled || this.errorMiddlewares.length === 0) {
      throw error;
    }

    let currentError = error;
    let currentContext = context;

    for (const middleware of this.errorMiddlewares) {
      try {
        const result = await this.executeWithTimeout(
          () => middleware(
            { error: currentError, context: currentContext },
            async () => {
              throw currentError;
            }
          ),
          this.config.timeout
        );
        
        return result.response;
      } catch (middlewareError) {
        if (middlewareError === currentError) {
          // Middleware didn't handle the error, continue to next
          continue;
        }
        
        // Middleware handled the error, return the response
        return (middlewareError as any).response;
      }
    }

    // No middleware handled the error
    throw error;
  }

  // Built-in middleware factories
  createLoggingMiddleware(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    return this.useRequest((request, next) => {
      console[level](`Request: ${request.config.method?.toUpperCase()} ${request.config.url}`, {
        requestId: request.context.requestId,
        serviceName: request.context.serviceName,
        config: request.config,
      });
      return next();
    });
  }

  createTimingMiddleware() {
    return this.useRequest((request, next) => {
      request.context.startTime = Date.now();
      return next();
    });
  }

  createHeaderMiddleware(headers: Record<string, string>) {
    return this.useRequest((request, next) => {
      request.config.headers = {
        ...request.config.headers,
        ...headers,
      };
      return next();
    });
  }

  createRetryMiddleware(maxRetries: number = 3, delay: number = 1000) {
    return this.useError(async (error, next) => {
      const retryCount = error.context.metadata.retryCount || 0;
      
      if (retryCount < maxRetries) {
        error.context.metadata.retryCount = retryCount + 1;
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, retryCount)));
        
        // Retry the request
        return next();
      }
      
      throw error;
    });
  }

  createCacheMiddleware(cacheKey: string, ttl: number = 300000) {
    return this.useRequest(async (request, next) => {
      // Check cache
      const cached = this.getFromCache(cacheKey);
      if (cached && Date.now() - cached.timestamp < ttl) {
        return {
          response: cached.response,
          context: request.context,
        };
      }
      
      // Execute request
      const result = await next();
      
      // Store in cache
      this.setInCache(cacheKey, result.response);
      
      return result;
    });
  }

  createAnalyticsMiddleware(tracker: (event: string, data: any) => void) {
    return this.useRequest((request, next) => {
      tracker('request_start', {
        url: request.config.url,
        method: request.config.method,
        requestId: request.context.requestId,
      });
      
      return next();
    });
  }

  createErrorReportingMiddleware(reporter: (error: AxiosError, context: MiddlewareContext) => void) {
    return this.useError((error, next) => {
      reporter(error.error, error.context);
      return next();
    });
  }

  createRequestDeduplicationMiddleware() {
    const pendingRequests = new Map<string, Promise<MiddlewareResponse>>();
    
    return this.useRequest(async (request, next) => {
      const key = this.getRequestKey(request.config);
      
      if (pendingRequests.has(key)) {
        return pendingRequests.get(key)!;
      }
      
      const promise = next();
      pendingRequests.set(key, promise);
      
      try {
        const result = await promise;
        return result;
      } finally {
        pendingRequests.delete(key);
      }
    });
  }

  createCircuitBreakerMiddleware(breaker: any) {
    return this.useRequest(async (request, next) => {
      return breaker.execute(() => next());
    });
  }

  // Utility methods
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Middleware timeout')), timeout);
      }),
    ]);
  }

  private getRequestKey(config: AxiosRequestConfig): string {
    return `${config.method || 'GET'}:${config.url}:${JSON.stringify(config.params || {})}`;
  }

  private getFromCache(key: string): { response: AxiosResponse; timestamp: number } | null {
    if (typeof window !== 'undefined' && window.localStorage) {
      const item = localStorage.getItem(`middleware_cache_${key}`);
      return item ? JSON.parse(item) : null;
    }
    return null;
  }

  private setInCache(key: string, response: AxiosResponse): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(`middleware_cache_${key}`, JSON.stringify({
        response,
        timestamp: Date.now(),
      }));
    }
  }

  // Middleware management
  clearAll(): void {
    this.requestMiddlewares = [];
    this.responseMiddlewares = [];
    this.errorMiddlewares = [];
  }

  getMiddlewareCount(): { request: number; response: number; error: number } {
    return {
      request: this.requestMiddlewares.length,
      response: this.responseMiddlewares.length,
      error: this.errorMiddlewares.length,
    };
  }

  updateConfig(newConfig: Partial<MiddlewareConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  destroy(): void {
    this.clearAll();
  }
}

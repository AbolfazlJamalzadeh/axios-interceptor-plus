// Main exports
export { AxiosInterceptor } from './interceptor';
export { ServiceFactory } from './services/serviceFactory';

// Core utility exports
export { ApiLogger } from './utils/logger';
export { RetryHandler } from './utils/retry';
export { AuthHandler } from './utils/auth';
export { ErrorHandler } from './utils/errorHandler';

// Advanced feature exports
export { RequestQueue } from './utils/requestQueue';
export { CacheManager } from './utils/cache';
export { TokenManager } from './utils/tokenManager';
export { EventBus } from './utils/eventBus';
export { CircuitBreakerManager } from './utils/circuitBreaker';
export { MiddlewareManager } from './utils/middleware';
export { RequestManager } from './utils/requestManager';
export { TransportManager } from './utils/transport';
export { MetricsCollector, ConsoleExporter, SentryExporter, PrometheusExporter } from './utils/monitoring';

// Type exports
export type {
  InterceptorConfig,
  RetryConfig,
  AuthConfig,
  ErrorConfig,
  LoggingConfig,
  ServiceConfig,
  ApiService,
  ServiceFactory as IServiceFactory,
  InterceptorInstance,
  LogLevel,
  Logger,
  // Advanced feature types
  QueueConfig,
  ThrottleConfig,
  CacheConfig,
  CacheStorage,
  TokenRotationConfig,
  EventType,
  EventBusConfig,
  CircuitBreakerConfig,
  CircuitState,
  MiddlewareConfig,
  RequestManagerConfig,
  TransportConfig,
  TransportType,
  MetricsConfig,
  MetricsExporter,
  MetricsData,
  GlobalMetrics,
  ServiceMetrics,
  RequestMetrics,
} from './types';

// Import for default export
import { AxiosInterceptor } from './interceptor';

// Factory function for easy initialization
export function createInterceptor(config?: any): any {
  return new AxiosInterceptor(config);
}

// Default export
export default AxiosInterceptor;

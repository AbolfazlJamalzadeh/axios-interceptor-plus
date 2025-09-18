import { AxiosRequestConfig, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';

export interface InterceptorConfig {
  baseURL?: string;
  timeout?: number;
  withCredentials?: boolean;
  headers?: Record<string, string>;
  retryConfig?: RetryConfig;
  authConfig?: AuthConfig;
  errorConfig?: ErrorConfig;
  loggingConfig?: LoggingConfig;
  queueConfig?: QueueConfig;
  throttleConfig?: ThrottleConfig;
  cacheConfig?: CacheConfig;
  tokenRotationConfig?: TokenRotationConfig;
  eventBusConfig?: EventBusConfig;
  circuitBreakerConfig?: CircuitBreakerConfig;
  middlewareConfig?: MiddlewareConfig;
  requestManagerConfig?: RequestManagerConfig;
  transportConfig?: TransportConfig;
  metricsConfig?: MetricsConfig;
}

export interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  retryDelay: number;
  retryCondition?: (error: AxiosError) => boolean;
  retryDelayFunction?: (retryCount: number) => number;
}

export interface AuthConfig {
  enabled: boolean;
  tokenKey: string;
  tokenPrefix: string;
  getToken?: () => string | null | Promise<string | null>;
  setToken?: (token: string) => void | Promise<void>;
  removeToken?: () => void | Promise<void>;
  onTokenExpired?: () => void | Promise<void>;
  onUnauthorized?: () => void | Promise<void>;
  refreshToken?: {
    enabled: boolean;
    getRefreshToken?: () => string | null | Promise<string | null>;
    refreshEndpoint?: string;
    onRefreshSuccess?: (newToken: string) => void | Promise<void>;
    onRefreshFailed?: () => void | Promise<void>;
  };
}

export interface ErrorConfig {
  onError?: (error: AxiosError) => void | Promise<void>;
  onNetworkError?: (error: AxiosError) => void | Promise<void>;
  onTimeoutError?: (error: AxiosError) => void | Promise<void>;
  onServerError?: (error: AxiosError) => void | Promise<void>;
  onClientError?: (error: AxiosError) => void | Promise<void>;
  transformError?: (error: AxiosError) => any;
  showErrorNotifications?: boolean;
  errorNotificationHandler?: (message: string, error: AxiosError) => void;
}

export interface LoggingConfig {
  enabled: boolean;
  level: 'debug' | 'info' | 'warn' | 'error';
  logRequests: boolean;
  logResponses: boolean;
  logErrors: boolean;
  logFunction?: (level: string, message: string, data?: any) => void;
  sensitiveHeaders?: string[];
  sensitiveDataKeys?: string[];
}

export interface ServiceConfig {
  name: string;
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  interceptors?: {
    request?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>;
    response?: (response: AxiosResponse) => AxiosResponse | Promise<AxiosResponse>;
    error?: (error: AxiosError) => any | Promise<any>;
  };
}

export interface ApiService {
  get: <T = any>(url: string, config?: AxiosRequestConfig) => Promise<T>;
  post: <T = any>(url: string, data?: any, config?: AxiosRequestConfig) => Promise<T>;
  put: <T = any>(url: string, data?: any, config?: AxiosRequestConfig) => Promise<T>;
  patch: <T = any>(url: string, data?: any, config?: AxiosRequestConfig) => Promise<T>;
  delete: <T = any>(url: string, config?: AxiosRequestConfig) => Promise<T>;
  head: <T = any>(url: string, config?: AxiosRequestConfig) => Promise<T>;
  options: <T = any>(url: string, config?: AxiosRequestConfig) => Promise<T>;
}

export interface ServiceFactory {
  createService: (config: ServiceConfig) => ApiService;
  getService: (name: string) => ApiService | undefined;
  removeService: (name: string) => boolean;
  listServices: () => string[];
}

export interface InterceptorInstance {
  addService: (config: ServiceConfig) => ApiService;
  getService: (name: string) => ApiService | undefined;
  removeService: (name: string) => boolean;
  listServices: () => string[];
  updateConfig: (newConfig: Partial<InterceptorConfig>) => void;
  destroy: () => void;
  getAxiosInstance: () => any;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, data?: any) => void;
  info: (message: string, data?: any) => void;
  warn: (message: string, data?: any) => void;
  error: (message: string, data?: any) => void;
}

// Request Queue & Throttling
export interface QueueConfig {
  concurrency: number;
  timeout: number;
  retryDelay: number;
  maxRetries: number;
}

export interface ThrottleConfig {
  enabled: boolean;
  requestsPerSecond: number;
  burstLimit: number;
  windowMs: number;
}

// Caching
export type CacheStorage = 'memory' | 'localStorage' | 'indexedDB';

export interface CacheConfig {
  enabled: boolean;
  storage: CacheStorage;
  ttl: number;
  maxSize: number;
  keyGenerator?: (config: AxiosRequestConfig) => string;
  shouldCache?: (response: AxiosResponse) => boolean;
  offlineFirst?: boolean;
}

// Advanced Token Management
export interface TokenRotationConfig {
  enabled: boolean;
  strategy: 'time_based' | 'usage_based' | 'error_based';
  rotationInterval?: number;
  maxUsageCount?: number;
  errorThreshold?: number;
  onTokenRotated?: (oldToken: string, newToken: string) => void;
}

// Event Bus & Hooks
export type EventType = 
  | 'request:start'
  | 'request:success'
  | 'request:error'
  | 'request:retry'
  | 'request:cancel'
  | 'auth:tokenExpired'
  | 'auth:tokenRefreshed'
  | 'auth:login'
  | 'auth:logout'
  | 'cache:hit'
  | 'cache:miss'
  | 'cache:set'
  | 'cache:clear'
  | 'queue:add'
  | 'queue:remove'
  | 'queue:process'
  | 'circuit:open'
  | 'circuit:close'
  | 'circuit:halfOpen';

export interface EventBusConfig {
  enabled: boolean;
  maxListeners: number;
  enableTiming: boolean;
  enableMetadata: boolean;
}

// Circuit Breaker
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  resetTimeout: number;
  monitoringPeriod: number;
  errorFilter?: (error: AxiosError) => boolean;
}

// Middleware System
export interface MiddlewareConfig {
  enabled: boolean;
  maxMiddlewares: number;
  timeout: number;
}

// Request Management
export interface RequestManagerConfig {
  enabled: boolean;
  deduplication: boolean;
  cancellation: boolean;
  maxConcurrentRequests: number;
  requestTimeout: number;
  deduplicationWindow: number;
}

// Multi-Transport
export type TransportType = 'axios' | 'fetch' | 'graphql' | 'websocket';

export interface TransportConfig {
  type: TransportType;
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
}

// Monitoring & Analytics
export interface MetricsConfig {
  enabled: boolean;
  collectTimings: boolean;
  collectErrors: boolean;
  collectRetries: boolean;
  collectCache: boolean;
  maxHistorySize: number;
  exportInterval?: number;
  exporters?: MetricsExporter[];
}

export interface MetricsExporter {
  name: string;
  export: (metrics: MetricsData) => Promise<void>;
}

export interface MetricsData {
  global: GlobalMetrics;
  requests: RequestMetrics[];
  timestamp: number;
}

export interface GlobalMetrics {
  totalRequests: number;
  totalErrors: number;
  totalRetries: number;
  totalCacheHits: number;
  averageResponseTime: number;
  errorRate: number;
  retryRate: number;
  cacheHitRate: number;
  uptime: number;
  services: Record<string, ServiceMetrics>;
}

export interface ServiceMetrics {
  serviceName: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  errorRate: number;
  retryRate: number;
  cacheHitRate: number;
  lastRequestTime?: number;
}

export interface RequestMetrics {
  requestId: string;
  url: string;
  method: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status?: number;
  statusText?: string;
  retryCount: number;
  cacheHit: boolean;
  error?: {
    message: string;
    code?: string;
    status?: number;
  };
}

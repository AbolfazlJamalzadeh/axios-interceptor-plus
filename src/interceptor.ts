import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { 
  InterceptorConfig, 
  InterceptorInstance, 
  ServiceConfig, 
  ApiService,
  AuthConfig,
  RetryConfig,
  ErrorConfig,
  LoggingConfig,
  QueueConfig,
  ThrottleConfig,
  CacheConfig,
  TokenRotationConfig,
  EventBusConfig,
  CircuitBreakerConfig,
  MiddlewareConfig,
  RequestManagerConfig,
  TransportConfig,
  MetricsConfig
} from './types';
import { ServiceFactory } from './services/serviceFactory';
import { RetryHandler } from './utils/retry';
import { AuthHandler } from './utils/auth';
import { ErrorHandler } from './utils/errorHandler';
import { ApiLogger } from './utils/logger';
import { RequestQueue } from './utils/requestQueue';
import { CacheManager } from './utils/cache';
import { TokenManager } from './utils/tokenManager';
import { EventBus } from './utils/eventBus';
import { CircuitBreakerManager } from './utils/circuitBreaker';
import { MiddlewareManager } from './utils/middleware';
import { RequestManager } from './utils/requestManager';
import { TransportManager } from './utils/transport';
import { MetricsCollector } from './utils/monitoring';

export class AxiosInterceptor implements InterceptorInstance {
  private instance: AxiosInstance;
  private serviceFactory: ServiceFactory;
  private retryHandler: RetryHandler;
  private authHandler: AuthHandler;
  private errorHandler: ErrorHandler;
  private logger: ApiLogger;
  private requestQueue: RequestQueue;
  private cacheManager: CacheManager;
  private tokenManager: TokenManager;
  private eventBus: EventBus;
  private circuitBreakerManager: CircuitBreakerManager;
  private middlewareManager: MiddlewareManager;
  private requestManager: RequestManager;
  private transportManager: TransportManager;
  private metricsCollector: MetricsCollector;
  private config: InterceptorConfig;

  constructor(config: InterceptorConfig = {}) {
    this.config = this.mergeWithDefaults(config);
    
    // Create axios instance
    this.instance = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      withCredentials: this.config.withCredentials,
      headers: this.config.headers,
    });

    // Initialize utilities
    this.logger = new ApiLogger(this.config.loggingConfig!);
    this.retryHandler = new RetryHandler(this.config.retryConfig!);
    this.authHandler = new AuthHandler(this.config.authConfig!);
    this.errorHandler = new ErrorHandler(this.config.errorConfig!, this.logger);
    
    // Initialize new features
    this.requestQueue = new RequestQueue(this.config.queueConfig!, this.config.throttleConfig!);
    this.cacheManager = new CacheManager(this.config.cacheConfig!);
    this.tokenManager = new TokenManager(this.config.tokenRotationConfig!);
    this.eventBus = new EventBus(this.config.eventBusConfig!);
    this.circuitBreakerManager = new CircuitBreakerManager(this.config.circuitBreakerConfig!);
    this.middlewareManager = new MiddlewareManager(this.config.middlewareConfig!);
    this.requestManager = new RequestManager(this.config.requestManagerConfig!);
    this.transportManager = new TransportManager();
    this.metricsCollector = new MetricsCollector(this.config.metricsConfig!);
    
    // Create service factory
    this.serviceFactory = new ServiceFactory(
      this.instance,
      this.retryHandler,
      this.authHandler,
      this.errorHandler,
      this.logger
    );

    // Setup global interceptors
    this.setupGlobalInterceptors();

    this.logger.info('AxiosInterceptor initialized with advanced features', { config: this.config });
  }

  private mergeWithDefaults(config: InterceptorConfig): InterceptorConfig {
    const defaultConfig: InterceptorConfig = {
      timeout: 10000,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
      retryConfig: {
        enabled: true,
        maxRetries: 3,
        retryDelay: 1000,
      },
      authConfig: {
        enabled: true,
        tokenKey: 'token',
        tokenPrefix: 'Bearer',
        getToken: () => {
          if (typeof window !== 'undefined' && window.localStorage) {
            return localStorage.getItem('token');
          }
          return null;
        },
        setToken: (token: string) => {
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem('token', token);
          }
        },
        removeToken: () => {
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.removeItem('token');
          }
        },
        onTokenExpired: () => {
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        },
        onUnauthorized: () => {
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        },
      },
      errorConfig: {
        showErrorNotifications: false,
      },
      loggingConfig: {
        enabled: true,
        level: 'info',
        logRequests: true,
        logResponses: true,
        logErrors: true,
        sensitiveHeaders: ['authorization', 'cookie'],
        sensitiveDataKeys: ['password', 'token', 'secret'],
      },
      // New advanced features
      queueConfig: {
        concurrency: 10,
        timeout: 30000,
        retryDelay: 1000,
        maxRetries: 3,
      },
      throttleConfig: {
        enabled: false,
        requestsPerSecond: 50,
        burstLimit: 100,
        windowMs: 1000,
      },
      cacheConfig: {
        enabled: false,
        storage: 'memory',
        ttl: 300000, // 5 minutes
        maxSize: 1000,
        offlineFirst: false,
      },
      tokenRotationConfig: {
        enabled: false,
        strategy: 'time_based',
        rotationInterval: 3600000, // 1 hour
      },
      eventBusConfig: {
        enabled: true,
        maxListeners: 100,
        enableTiming: true,
        enableMetadata: true,
      },
      circuitBreakerConfig: {
        enabled: false,
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 60000,
        resetTimeout: 30000,
        monitoringPeriod: 10000,
      },
      middlewareConfig: {
        enabled: true,
        maxMiddlewares: 50,
        timeout: 5000,
      },
      requestManagerConfig: {
        enabled: true,
        deduplication: true,
        cancellation: true,
        maxConcurrentRequests: 100,
        requestTimeout: 30000,
        deduplicationWindow: 5000,
      },
      transportConfig: {
        type: 'axios',
        timeout: 10000,
      },
      metricsConfig: {
        enabled: true,
        collectTimings: true,
        collectErrors: true,
        collectRetries: true,
        collectCache: true,
        maxHistorySize: 10000,
      },
    };

    return {
      ...defaultConfig,
      ...config,
      retryConfig: { ...defaultConfig.retryConfig!, ...config.retryConfig },
      authConfig: { ...defaultConfig.authConfig!, ...config.authConfig },
      errorConfig: { ...defaultConfig.errorConfig!, ...config.errorConfig },
      loggingConfig: { ...defaultConfig.loggingConfig!, ...config.loggingConfig },
      queueConfig: { ...defaultConfig.queueConfig!, ...config.queueConfig },
      throttleConfig: { ...defaultConfig.throttleConfig!, ...config.throttleConfig },
      cacheConfig: { ...defaultConfig.cacheConfig!, ...config.cacheConfig },
      tokenRotationConfig: { ...defaultConfig.tokenRotationConfig!, ...config.tokenRotationConfig },
      eventBusConfig: { ...defaultConfig.eventBusConfig!, ...config.eventBusConfig },
      circuitBreakerConfig: { ...defaultConfig.circuitBreakerConfig!, ...config.circuitBreakerConfig },
      middlewareConfig: { ...defaultConfig.middlewareConfig!, ...config.middlewareConfig },
      requestManagerConfig: { ...defaultConfig.requestManagerConfig!, ...config.requestManagerConfig },
      transportConfig: { ...defaultConfig.transportConfig!, ...config.transportConfig },
      metricsConfig: { ...defaultConfig.metricsConfig!, ...config.metricsConfig },
    };
  }

  private setupGlobalInterceptors(): void {
    // Request interceptor
    this.instance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // Add auth header
        const authConfig = await this.authHandler.addAuthHeader(config as any);
        Object.assign(config, authConfig);

        this.logger.debug('Global request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          baseURL: config.baseURL,
          headers: config.headers,
        });

        return config;
      },
      (error) => {
        this.logger.error('Global request error', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.instance.interceptors.response.use(
      (response: AxiosResponse) => {
        this.logger.debug('Global response', {
          status: response.status,
          statusText: response.statusText,
          data: response.data,
        });

        return response;
      },
      async (error: AxiosError) => {
        // Handle auth errors
        await this.authHandler.handleAuthError(error);
        
        // Handle error
        return await this.errorHandler.handleError(error);
      }
    );
  }

  addService(config: ServiceConfig): ApiService {
    return this.serviceFactory.createService(config);
  }

  getService(name: string): ApiService | undefined {
    return this.serviceFactory.getService(name);
  }

  removeService(name: string): boolean {
    return this.serviceFactory.removeService(name);
  }

  listServices(): string[] {
    return this.serviceFactory.listServices();
  }

  updateConfig(newConfig: Partial<InterceptorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update individual handlers
    if (newConfig.retryConfig) {
      this.retryHandler.updateConfig(newConfig.retryConfig);
    }
    
    if (newConfig.authConfig) {
      this.authHandler.updateConfig(newConfig.authConfig);
    }
    
    if (newConfig.errorConfig) {
      this.errorHandler.updateConfig(newConfig.errorConfig);
    }
    
    if (newConfig.loggingConfig) {
      this.logger.updateConfig(newConfig.loggingConfig);
    }

    this.logger.info('Configuration updated', { newConfig });
  }

  destroy(): void {
    // Clear all services
    this.serviceFactory.listServices().forEach(serviceName => {
      this.serviceFactory.removeService(serviceName);
    });

    // Clear interceptors
    this.instance.interceptors.request.clear();
    this.instance.interceptors.response.clear();

    // Clean up new features
    this.requestQueue?.destroy?.();
    this.cacheManager?.clear?.();
    this.tokenManager?.destroy?.();
    this.eventBus?.destroy?.();
    this.circuitBreakerManager?.destroy?.();
    this.middlewareManager?.destroy?.();
    this.requestManager?.destroy?.();
    this.transportManager?.destroy?.();
    this.metricsCollector?.destroy?.();

    this.logger.info('AxiosInterceptor destroyed with all features cleaned up');
  }

  // Get the raw axios instance for advanced usage
  getAxiosInstance(): AxiosInstance {
    return this.instance;
  }
}

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { ServiceConfig, ApiService, ServiceFactory as IServiceFactory } from '../types';
import { RetryHandler } from '../utils/retry';
import { AuthHandler } from '../utils/auth';
import { ErrorHandler } from '../utils/errorHandler';
import { ApiLogger } from '../utils/logger';

export class ServiceFactory implements IServiceFactory {
  private services: Map<string, ApiService> = new Map();
  private axiosInstance: AxiosInstance;
  private retryHandler: RetryHandler;
  private authHandler: AuthHandler;
  private errorHandler: ErrorHandler;
  private logger: ApiLogger;

  constructor(
    axiosInstance: AxiosInstance,
    retryHandler: RetryHandler,
    authHandler: AuthHandler,
    errorHandler: ErrorHandler,
    logger: ApiLogger
  ) {
    this.axiosInstance = axiosInstance;
    this.retryHandler = retryHandler;
    this.authHandler = authHandler;
    this.errorHandler = errorHandler;
    this.logger = logger;
  }

  createService(config: ServiceConfig): ApiService {
    // Create a new axios instance for this service
    const serviceInstance = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout,
      headers: config.headers,
    });

    // Apply service-specific interceptors
    this.setupServiceInterceptors(serviceInstance, config);

    // Create the service wrapper
    const service: ApiService = {
      get: <T = any>(url: string, requestConfig?: AxiosRequestConfig) => 
        this.executeRequest<T>(() => serviceInstance.get(url, requestConfig)),
      
      post: <T = any>(url: string, data?: any, requestConfig?: AxiosRequestConfig) => 
        this.executeRequest<T>(() => serviceInstance.post(url, data, requestConfig)),
      
      put: <T = any>(url: string, data?: any, requestConfig?: AxiosRequestConfig) => 
        this.executeRequest<T>(() => serviceInstance.put(url, data, requestConfig)),
      
      patch: <T = any>(url: string, data?: any, requestConfig?: AxiosRequestConfig) => 
        this.executeRequest<T>(() => serviceInstance.patch(url, data, requestConfig)),
      
      delete: <T = any>(url: string, requestConfig?: AxiosRequestConfig) => 
        this.executeRequest<T>(() => serviceInstance.delete(url, requestConfig)),
      
      head: <T = any>(url: string, requestConfig?: AxiosRequestConfig) => 
        this.executeRequest<T>(() => serviceInstance.head(url, requestConfig)),
      
      options: <T = any>(url: string, requestConfig?: AxiosRequestConfig) => 
        this.executeRequest<T>(() => serviceInstance.options(url, requestConfig)),
    };

    // Store the service
    this.services.set(config.name, service);
    
    this.logger.info(`Service '${config.name}' created successfully`);
    
    return service;
  }

  getService(name: string): ApiService | undefined {
    return this.services.get(name);
  }

  removeService(name: string): boolean {
    const removed = this.services.delete(name);
    if (removed) {
      this.logger.info(`Service '${name}' removed successfully`);
    }
    return removed;
  }

  listServices(): string[] {
    return Array.from(this.services.keys());
  }

  private setupServiceInterceptors(instance: AxiosInstance, config: ServiceConfig): void {
    // Request interceptor
    instance.interceptors.request.use(
      async (requestConfig: InternalAxiosRequestConfig) => {
        // Add auth header
        const authConfig = await this.authHandler.addAuthHeader(requestConfig as any);
        Object.assign(requestConfig, authConfig);
        
        // Apply custom request interceptor
        if (config.interceptors?.request) {
          requestConfig = await config.interceptors.request(requestConfig);
        }

        this.logger.debug(`Service '${config.name}' request`, {
          method: requestConfig.method?.toUpperCase(),
          url: requestConfig.url,
          baseURL: requestConfig.baseURL,
          headers: requestConfig.headers,
        });

        return requestConfig;
      },
      (error) => {
        this.logger.error(`Service '${config.name}' request error`, error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    instance.interceptors.response.use(
      async (response: AxiosResponse) => {
        // Apply custom response interceptor
        if (config.interceptors?.response) {
          return await config.interceptors.response(response);
        }

        this.logger.debug(`Service '${config.name}' response`, {
          status: response.status,
          statusText: response.statusText,
          data: response.data,
        });

        return response;
      },
      async (error: AxiosError) => {
        // Handle auth errors
        await this.authHandler.handleAuthError(error);
        
        // Apply custom error interceptor
        if (config.interceptors?.error) {
          return await config.interceptors.error(error);
        }

        // Handle error
        return await this.errorHandler.handleError(error);
      }
    );
  }

  private async executeRequest<T>(requestFn: () => Promise<AxiosResponse<T>>): Promise<T> {
    try {
      const response = await this.retryHandler.executeWithRetry(requestFn);
      return response.data;
    } catch (error) {
      throw error;
    }
  }
}

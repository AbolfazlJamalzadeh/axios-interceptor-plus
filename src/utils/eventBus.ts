import { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

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

export interface EventData {
  requestId?: string;
  url?: string;
  method?: string;
  status?: number;
  duration?: number;
  retryCount?: number;
  error?: AxiosError;
  response?: AxiosResponse;
  config?: AxiosRequestConfig;
  metadata?: Record<string, any>;
}

export interface EventHandler {
  (event: EventData): void | Promise<void>;
}

export interface EventBusConfig {
  enabled: boolean;
  maxListeners: number;
  enableTiming: boolean;
  enableMetadata: boolean;
}

export class EventBus {
  private listeners: Map<EventType, Set<EventHandler>> = new Map();
  private config: EventBusConfig;
  private eventHistory: Array<{ type: EventType; data: EventData; timestamp: number }> = [];
  private maxHistorySize: number = 1000;

  constructor(config: EventBusConfig) {
    this.config = config;
  }

  on(eventType: EventType, handler: EventHandler): () => void {
    if (!this.config.enabled) {
      return () => {};
    }

    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }

    const listeners = this.listeners.get(eventType)!;
    
    if (listeners.size >= this.config.maxListeners) {
      console.warn(`Maximum listeners (${this.config.maxListeners}) reached for event: ${eventType}`);
      return () => {};
    }

    listeners.add(handler);

    // Return unsubscribe function
    return () => {
      listeners.delete(handler);
    };
  }

  off(eventType: EventType, handler: EventHandler): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(handler);
    }
  }

  async emit(eventType: EventType, data: EventData = {}): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Add timing and metadata if enabled
    const enrichedData = this.enrichEventData(data);

    // Store in history
    this.addToHistory(eventType, enrichedData);

    // Get listeners for this event type
    const listeners = this.listeners.get(eventType);
    if (!listeners || listeners.size === 0) {
      return;
    }

    // Execute all listeners
    const promises = Array.from(listeners).map(handler => {
      try {
        return handler(enrichedData);
      } catch (error) {
        console.error(`Error in event handler for ${eventType}:`, error);
        return Promise.resolve();
      }
    });

    await Promise.allSettled(promises);
  }

  // Convenience methods for common events
  async emitRequestStart(requestId: string, config: AxiosRequestConfig): Promise<void> {
    await this.emit('request:start', {
      requestId,
      url: config.url,
      method: config.method,
      config,
    });
  }

  async emitRequestSuccess(
    requestId: string,
    response: AxiosResponse,
    duration: number
  ): Promise<void> {
    await this.emit('request:success', {
      requestId,
      url: response.config.url,
      method: response.config.method,
      status: response.status,
      duration,
      response,
    });
  }

  async emitRequestError(
    requestId: string,
    error: AxiosError,
    duration: number
  ): Promise<void> {
    await this.emit('request:error', {
      requestId,
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      duration,
      error,
    });
  }

  async emitRequestRetry(
    requestId: string,
    retryCount: number,
    error: AxiosError
  ): Promise<void> {
    await this.emit('request:retry', {
      requestId,
      url: error.config?.url,
      method: error.config?.method,
      retryCount,
      error,
    });
  }

  async emitAuthTokenExpired(tokenType: string): Promise<void> {
    await this.emit('auth:tokenExpired', {
      metadata: { tokenType },
    });
  }

  async emitAuthTokenRefreshed(oldToken: string, newToken: string): Promise<void> {
    await this.emit('auth:tokenRefreshed', {
      metadata: { oldToken, newToken },
    });
  }

  async emitCacheHit(key: string, response: AxiosResponse): Promise<void> {
    await this.emit('cache:hit', {
      url: response.config.url,
      method: response.config.method,
      metadata: { cacheKey: key },
    });
  }

  async emitCacheMiss(key: string, config: AxiosRequestConfig): Promise<void> {
    await this.emit('cache:miss', {
      url: config.url,
      method: config.method,
      metadata: { cacheKey: key },
    });
  }

  async emitCircuitOpen(serviceName: string, error: AxiosError): Promise<void> {
    await this.emit('circuit:open', {
      url: error.config?.url,
      method: error.config?.method,
      error,
      metadata: { serviceName },
    });
  }

  async emitCircuitClose(serviceName: string): Promise<void> {
    await this.emit('circuit:close', {
      metadata: { serviceName },
    });
  }

  // Event history and analytics
  getEventHistory(eventType?: EventType): Array<{ type: EventType; data: EventData; timestamp: number }> {
    if (eventType) {
      return this.eventHistory.filter(event => event.type === eventType);
    }
    return [...this.eventHistory];
  }

  getEventStats(): Record<EventType, number> {
    const stats: Record<string, number> = {};
    
    for (const event of this.eventHistory) {
      stats[event.type] = (stats[event.type] || 0) + 1;
    }
    
    return stats as Record<EventType, number>;
  }

  getRequestTimings(): Array<{ requestId: string; duration: number; url: string; method: string }> {
    return this.eventHistory
      .filter(event => event.type === 'request:success' && event.data.duration)
      .map(event => ({
        requestId: event.data.requestId || '',
        duration: event.data.duration || 0,
        url: event.data.url || '',
        method: event.data.method || '',
      }));
  }

  getErrorStats(): Array<{ url: string; method: string; status: number; count: number }> {
    const errorMap = new Map<string, { url: string; method: string; status: number; count: number }>();
    
    for (const event of this.eventHistory) {
      if (event.type === 'request:error' && event.data.url && event.data.method) {
        const key = `${event.data.method}:${event.data.url}`;
        const existing = errorMap.get(key);
        
        if (existing) {
          existing.count++;
        } else {
          errorMap.set(key, {
            url: event.data.url,
            method: event.data.method,
            status: event.data.status || 0,
            count: 1,
          });
        }
      }
    }
    
    return Array.from(errorMap.values());
  }

  clearHistory(): void {
    this.eventHistory = [];
  }

  // Middleware support
  createMiddleware(eventType: EventType, handler: EventHandler) {
    return this.on(eventType, handler);
  }

  // Batch event emission
  async emitBatch(events: Array<{ type: EventType; data: EventData }>): Promise<void> {
    const promises = events.map(event => this.emit(event.type, event.data));
    await Promise.allSettled(promises);
  }

  // Event filtering
  onFiltered(
    eventType: EventType,
    filter: (data: EventData) => boolean,
    handler: EventHandler
  ): () => void {
    const filteredHandler = (data: EventData) => {
      if (filter(data)) {
        return handler(data);
      }
    };
    
    return this.on(eventType, filteredHandler);
  }

  // Debug mode
  enableDebugMode(): void {
    this.on('request:start', (data) => {
      console.log(`🚀 Request started: ${data.method} ${data.url}`, data);
    });
    
    this.on('request:success', (data) => {
      console.log(`✅ Request success: ${data.method} ${data.url} (${data.duration}ms)`, data);
    });
    
    this.on('request:error', (data) => {
      console.log(`❌ Request error: ${data.method} ${data.url} (${data.status})`, data);
    });
    
    this.on('request:retry', (data) => {
      console.log(`🔄 Request retry: ${data.method} ${data.url} (attempt ${data.retryCount})`, data);
    });
  }

  // Private methods
  private enrichEventData(data: EventData): EventData {
    const enriched = { ...data };
    
    if (this.config.enableTiming && !enriched.duration) {
      enriched.duration = 0; // Will be set by the caller
    }
    
    if (this.config.enableMetadata && !enriched.metadata) {
      enriched.metadata = {};
    }
    
    return enriched;
  }

  private addToHistory(eventType: EventType, data: EventData): void {
    this.eventHistory.push({
      type: eventType,
      data,
      timestamp: Date.now(),
    });
    
    // Keep history size manageable
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  updateConfig(newConfig: Partial<EventBusConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  destroy(): void {
    this.listeners.clear();
    this.eventHistory = [];
  }
}

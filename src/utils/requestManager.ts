import { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

export interface RequestManagerConfig {
  enabled: boolean;
  deduplication: boolean;
  cancellation: boolean;
  maxConcurrentRequests: number;
  requestTimeout: number;
  deduplicationWindow: number; // Time window for deduplication in ms
}

export interface PendingRequest {
  id: string;
  config: AxiosRequestConfig;
  controller: AbortController;
  promise: Promise<AxiosResponse>;
  timestamp: number;
  resolve: (value: AxiosResponse) => void;
  reject: (error: any) => void;
}

export interface RequestStats {
  totalRequests: number;
  activeRequests: number;
  completedRequests: number;
  cancelledRequests: number;
  deduplicatedRequests: number;
  averageResponseTime: number;
  errorRate: number;
}

export class RequestManager {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private deduplicationMap: Map<string, PendingRequest> = new Map();
  private requestHistory: Array<{
    id: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    status: 'pending' | 'completed' | 'cancelled' | 'error';
    error?: AxiosError;
  }> = [];
  private config: RequestManagerConfig;
  private stats: RequestStats = {
    totalRequests: 0,
    activeRequests: 0,
    completedRequests: 0,
    cancelledRequests: 0,
    deduplicatedRequests: 0,
    averageResponseTime: 0,
    errorRate: 0,
  };

  constructor(config: RequestManagerConfig) {
    this.config = config;
    this.startCleanup();
  }

  async executeRequest<T>(
    config: AxiosRequestConfig,
    requestFn: (config: AxiosRequestConfig) => Promise<AxiosResponse>
  ): Promise<AxiosResponse> {
    if (!this.config.enabled) {
      return requestFn(config);
    }

    const requestId = this.generateRequestId();
    const requestKey = this.getRequestKey(config);

    // Check for deduplication
    if (this.config.deduplication && this.deduplicationMap.has(requestKey)) {
      const existingRequest = this.deduplicationMap.get(requestKey)!;
      this.stats.deduplicatedRequests++;
      return existingRequest.promise;
    }

    // Check concurrency limit
    if (this.pendingRequests.size >= this.config.maxConcurrentRequests) {
      throw new Error(`Maximum concurrent requests (${this.config.maxConcurrentRequests}) exceeded`);
    }

    // Create abort controller
    const controller = new AbortController();
    
    // Create request promise
    const promise = new Promise<AxiosResponse>((resolve, reject) => {
      const pendingRequest: PendingRequest = {
        id: requestId,
        config,
        controller,
        promise: Promise.resolve({} as AxiosResponse), // Will be set below
        timestamp: Date.now(),
        resolve,
        reject,
      };

      // Add to pending requests
      this.pendingRequests.set(requestId, pendingRequest);
      
      // Add to deduplication map
      if (this.config.deduplication) {
        this.deduplicationMap.set(requestKey, pendingRequest);
      }

      // Add to history
      this.requestHistory.push({
        id: requestId,
        startTime: Date.now(),
        status: 'pending',
      });

      this.stats.totalRequests++;
      this.stats.activeRequests++;

      // Execute the actual request
      this.executeActualRequest(config, controller, pendingRequest, requestFn)
        .then(response => {
          this.handleRequestSuccess(requestId, response);
        })
        .catch(error => {
          this.handleRequestError(requestId, error);
        });
    });

    // Set the promise on the pending request
    const pendingRequest = this.pendingRequests.get(requestId)!;
    pendingRequest.promise = promise;

    return promise;
  }

  cancelRequest(requestId: string): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return false;
    }

    request.controller.abort();
    this.handleRequestCancellation(requestId);
    return true;
  }

  cancelAllRequests(): number {
    const cancelledCount = this.pendingRequests.size;
    
    for (const [requestId, request] of this.pendingRequests) {
      request.controller.abort();
      this.handleRequestCancellation(requestId);
    }
    
    return cancelledCount;
  }

  cancelRequestsByPattern(pattern: RegExp): number {
    let cancelledCount = 0;
    
    for (const [requestId, request] of this.pendingRequests) {
      if (pattern.test(request.config.url || '')) {
        request.controller.abort();
        this.handleRequestCancellation(requestId);
        cancelledCount++;
      }
    }
    
    return cancelledCount;
  }

  getPendingRequests(): Array<{
    id: string;
    url: string;
    method: string;
    timestamp: number;
    duration: number;
  }> {
    const now = Date.now();
    return Array.from(this.pendingRequests.values()).map(request => ({
      id: request.id,
      url: request.config.url || '',
      method: request.config.method || 'GET',
      timestamp: request.timestamp,
      duration: now - request.timestamp,
    }));
  }

  getStats(): RequestStats {
    return { ...this.stats };
  }

  getRequestHistory(limit?: number): Array<{
    id: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    status: string;
    url: string;
    method: string;
  }> {
    const history = this.requestHistory
      .map(entry => {
        const request = this.pendingRequests.get(entry.id);
        return {
          ...entry,
          url: request?.config.url || '',
          method: request?.config.method || 'GET',
        };
      })
      .sort((a, b) => b.startTime - a.startTime);

    return limit ? history.slice(0, limit) : history;
  }

  clearHistory(): void {
    this.requestHistory = [];
  }

  // Private methods
  private async executeActualRequest(
    config: AxiosRequestConfig,
    controller: AbortController,
    pendingRequest: PendingRequest,
    requestFn: (config: AxiosRequestConfig) => Promise<AxiosResponse>
  ): Promise<AxiosResponse> {
    // Add abort signal to config
    const configWithAbort = {
      ...config,
      signal: controller.signal,
    };

    // Set timeout
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.requestTimeout);

    try {
      const response = await requestFn(configWithAbort);
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private handleRequestSuccess(requestId: string, response: AxiosResponse): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) return;

    const duration = Date.now() - request.timestamp;
    
    // Update stats
    this.stats.activeRequests--;
    this.stats.completedRequests++;
    this.updateAverageResponseTime(duration);

    // Update history
    const historyEntry = this.requestHistory.find(entry => entry.id === requestId);
    if (historyEntry) {
      historyEntry.endTime = Date.now();
      historyEntry.duration = duration;
      historyEntry.status = 'completed';
    }

    // Clean up
    this.pendingRequests.delete(requestId);
    this.deduplicationMap.delete(this.getRequestKey(request.config));

    // Resolve promise
    request.resolve(response);
  }

  private handleRequestError(requestId: string, error: AxiosError): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) return;

    const duration = Date.now() - request.timestamp;
    
    // Update stats
    this.stats.activeRequests--;
    this.stats.completedRequests++;
    this.updateAverageResponseTime(duration);
    this.updateErrorRate();

    // Update history
    const historyEntry = this.requestHistory.find(entry => entry.id === requestId);
    if (historyEntry) {
      historyEntry.endTime = Date.now();
      historyEntry.duration = duration;
      historyEntry.status = 'error';
      historyEntry.error = error;
    }

    // Clean up
    this.pendingRequests.delete(requestId);
    this.deduplicationMap.delete(this.getRequestKey(request.config));

    // Reject promise
    request.reject(error);
  }

  private handleRequestCancellation(requestId: string): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) return;

    const duration = Date.now() - request.timestamp;
    
    // Update stats
    this.stats.activeRequests--;
    this.stats.cancelledRequests++;

    // Update history
    const historyEntry = this.requestHistory.find(entry => entry.id === requestId);
    if (historyEntry) {
      historyEntry.endTime = Date.now();
      historyEntry.duration = duration;
      historyEntry.status = 'cancelled';
    }

    // Clean up
    this.pendingRequests.delete(requestId);
    this.deduplicationMap.delete(this.getRequestKey(request.config));

    // Reject promise
    request.reject(new Error('Request cancelled'));
  }

  private updateAverageResponseTime(duration: number): void {
    const totalCompleted = this.stats.completedRequests + this.stats.cancelledRequests;
    if (totalCompleted > 0) {
      this.stats.averageResponseTime = 
        (this.stats.averageResponseTime * (totalCompleted - 1) + duration) / totalCompleted;
    }
  }

  private updateErrorRate(): void {
    const totalRequests = this.stats.completedRequests + this.stats.cancelledRequests;
    if (totalRequests > 0) {
      const errorCount = this.requestHistory.filter(entry => entry.status === 'error').length;
      this.stats.errorRate = errorCount / totalRequests;
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getRequestKey(config: AxiosRequestConfig): string {
    const method = config.method || 'GET';
    const url = config.url || '';
    const params = JSON.stringify(config.params || {});
    const data = JSON.stringify(config.data || {});
    return `${method}:${url}:${params}:${data}`;
  }

  private startCleanup(): void {
    setInterval(() => {
      this.cleanupExpiredRequests();
    }, 60000); // Cleanup every minute
  }

  private cleanupExpiredRequests(): void {
    const now = Date.now();
    const expiredRequests: string[] = [];

    for (const [requestId, request] of this.pendingRequests) {
      if (now - request.timestamp > this.config.requestTimeout) {
        expiredRequests.push(requestId);
      }
    }

    for (const requestId of expiredRequests) {
      this.cancelRequest(requestId);
    }

    // Clean up old history entries
    const cutoff = now - (24 * 60 * 60 * 1000); // 24 hours
    this.requestHistory = this.requestHistory.filter(entry => entry.startTime > cutoff);
  }

  updateConfig(newConfig: Partial<RequestManagerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  destroy(): void {
    this.cancelAllRequests();
    this.clearHistory();
  }
}

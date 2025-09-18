import { AxiosRequestConfig, AxiosResponse } from 'axios';

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

export interface QueuedRequest {
  id: string;
  config: AxiosRequestConfig;
  resolve: (value: AxiosResponse) => void;
  reject: (error: any) => void;
  retryCount: number;
  timestamp: number;
  priority: number;
}

export class RequestQueue {
  private queue: QueuedRequest[] = [];
  private running: Set<string> = new Set();
  private throttleTokens: number = 0;
  private lastRefill: number = Date.now();
  private requestCounts: Map<string, number[]> = new Map();

  constructor(
    private queueConfig: QueueConfig,
    private throttleConfig: ThrottleConfig
  ) {
    if (throttleConfig.enabled) {
      this.startThrottleRefill();
    }
  }

  async addRequest(
    config: AxiosRequestConfig,
    priority: number = 0
  ): Promise<AxiosResponse> {
    const requestId = this.generateRequestId();
    
    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        id: requestId,
        config,
        resolve,
        reject,
        retryCount: 0,
        timestamp: Date.now(),
        priority,
      };

      // Insert request based on priority (higher priority first)
      const insertIndex = this.queue.findIndex(req => req.priority < priority);
      if (insertIndex === -1) {
        this.queue.push(queuedRequest);
      } else {
        this.queue.splice(insertIndex, 0, queuedRequest);
      }

      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.running.size >= this.queueConfig.concurrency) {
      return;
    }

    const request = this.getNextRequest();
    if (!request) {
      return;
    }

    // Check throttling
    if (this.throttleConfig.enabled && !this.canMakeRequest(request.config)) {
      // Re-queue the request
      setTimeout(() => this.processQueue(), 100);
      return;
    }

    this.running.add(request.id);
    this.queue = this.queue.filter(req => req.id !== request.id);

    try {
      const response = await this.executeRequest(request);
      request.resolve(response);
    } catch (error) {
      if (request.retryCount < this.queueConfig.maxRetries) {
        request.retryCount++;
        request.timestamp = Date.now();
        this.queue.unshift(request); // Add back to front of queue
      } else {
        request.reject(error);
      }
    } finally {
      this.running.delete(request.id);
      this.processQueue(); // Process next request
    }
  }

  private getNextRequest(): QueuedRequest | null {
    // Sort by priority (higher first) and then by timestamp
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.timestamp - b.timestamp;
    });

    return this.queue[0] || null;
  }

  private canMakeRequest(config: AxiosRequestConfig): boolean {
    if (!this.throttleConfig.enabled) {
      return true;
    }

    const now = Date.now();
    const windowStart = now - this.throttleConfig.windowMs;
    const url = this.getRequestKey(config);
    
    // Get request history for this URL
    let requests = this.requestCounts.get(url) || [];
    requests = requests.filter(timestamp => timestamp > windowStart);
    
    // Check if we can make another request
    if (requests.length >= this.throttleConfig.requestsPerSecond) {
      return false;
    }

    // Add current request timestamp
    requests.push(now);
    this.requestCounts.set(url, requests);

    return true;
  }

  private async executeRequest(request: QueuedRequest): Promise<AxiosResponse> {
    // This would be implemented with the actual HTTP client
    // For now, we'll simulate the request
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, this.queueConfig.timeout);

      // Simulate request execution
      setTimeout(() => {
        clearTimeout(timeout);
        resolve({
          data: { message: 'Success' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: request.config,
        } as AxiosResponse);
      }, Math.random() * 1000);
    });
  }

  private startThrottleRefill(): void {
    setInterval(() => {
      const now = Date.now();
      const timePassed = now - this.lastRefill;
      const tokensToAdd = (timePassed / 1000) * this.throttleConfig.requestsPerSecond;
      
      this.throttleTokens = Math.min(
        this.throttleConfig.burstLimit,
        this.throttleTokens + tokensToAdd
      );
      
      this.lastRefill = now;
    }, 100);
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getRequestKey(config: AxiosRequestConfig): string {
    return `${config.method || 'GET'}:${config.url || ''}`;
  }

  // Public methods for monitoring
  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      runningCount: this.running.size,
      concurrencyLimit: this.queueConfig.concurrency,
      throttleEnabled: this.throttleConfig.enabled,
      throttleTokens: this.throttleTokens,
    };
  }

  clearQueue(): void {
    this.queue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });
    this.queue = [];
  }

  updateConfig(newQueueConfig: Partial<QueueConfig>, newThrottleConfig: Partial<ThrottleConfig>): void {
    this.queueConfig = { ...this.queueConfig, ...newQueueConfig };
    this.throttleConfig = { ...this.throttleConfig, ...newThrottleConfig };
  }

  destroy(): void {
    this.clearQueue();
    this.running.clear();
    this.requestCounts.clear();
  }
}

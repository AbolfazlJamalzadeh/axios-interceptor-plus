import { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

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

export interface MetricsData {
  global: GlobalMetrics;
  requests: RequestMetrics[];
  timestamp: number;
}

export class MetricsCollector {
  private config: MetricsConfig;
  private requestHistory: RequestMetrics[] = [];
  private serviceMetrics: Map<string, ServiceMetrics> = new Map();
  private globalMetrics: GlobalMetrics;
  private startTime: number;
  private exportTimer?: NodeJS.Timeout;

  constructor(config: MetricsConfig) {
    this.config = config;
    this.startTime = Date.now();
    this.globalMetrics = this.initializeGlobalMetrics();
    this.startExportTimer();
  }

  recordRequestStart(
    requestId: string,
    config: AxiosRequestConfig,
    serviceName?: string
  ): void {
    if (!this.config.enabled) return;

    const metrics: RequestMetrics = {
      requestId,
      url: config.url || '',
      method: config.method || 'GET',
      startTime: Date.now(),
      retryCount: 0,
      cacheHit: false,
    };

    this.requestHistory.push(metrics);
    this.enforceMaxHistorySize();
  }

  recordRequestSuccess(
    requestId: string,
    response: AxiosResponse,
    serviceName?: string
  ): void {
    if (!this.config.enabled) return;

    const metrics = this.findRequestMetrics(requestId);
    if (!metrics) return;

    const endTime = Date.now();
    metrics.endTime = endTime;
    metrics.duration = endTime - metrics.startTime;
    metrics.status = response.status;
    metrics.statusText = response.statusText;

    this.updateServiceMetrics(serviceName, metrics, true);
    this.updateGlobalMetrics(metrics, true);
  }

  recordRequestError(
    requestId: string,
    error: AxiosError,
    serviceName?: string
  ): void {
    if (!this.config.enabled) return;

    const metrics = this.findRequestMetrics(requestId);
    if (!metrics) return;

    const endTime = Date.now();
    metrics.endTime = endTime;
    metrics.duration = endTime - metrics.startTime;
    metrics.status = error.response?.status;
    metrics.statusText = error.response?.statusText;
    metrics.error = {
      message: error.message,
      code: error.code,
      status: error.response?.status,
    };

    this.updateServiceMetrics(serviceName, metrics, false);
    this.updateGlobalMetrics(metrics, false);
  }

  recordRetry(requestId: string, retryCount: number): void {
    if (!this.config.enabled) return;

    const metrics = this.findRequestMetrics(requestId);
    if (metrics) {
      metrics.retryCount = retryCount;
      this.globalMetrics.totalRetries++;
    }
  }

  recordCacheHit(requestId: string): void {
    if (!this.config.enabled) return;

    const metrics = this.findRequestMetrics(requestId);
    if (metrics) {
      metrics.cacheHit = true;
      this.globalMetrics.totalCacheHits++;
    }
  }

  getMetrics(): MetricsData {
    return {
      global: this.calculateGlobalMetrics(),
      requests: [...this.requestHistory],
      timestamp: Date.now(),
    };
  }

  getServiceMetrics(serviceName: string): ServiceMetrics | null {
    return this.serviceMetrics.get(serviceName) || null;
  }

  getAllServiceMetrics(): Record<string, ServiceMetrics> {
    const result: Record<string, ServiceMetrics> = {};
    for (const [name, metrics] of this.serviceMetrics) {
      result[name] = metrics;
    }
    return result;
  }

  getRequestHistory(limit?: number): RequestMetrics[] {
    const history = [...this.requestHistory].sort((a, b) => b.startTime - a.startTime);
    return limit ? history.slice(0, limit) : history;
  }

  getErrorStats(): Array<{
    url: string;
    method: string;
    status: number;
    count: number;
    lastOccurrence: number;
  }> {
    const errorMap = new Map<string, {
      url: string;
      method: string;
      status: number;
      count: number;
      lastOccurrence: number;
    }>();

    for (const request of this.requestHistory) {
      if (request.error) {
        const key = `${request.method}:${request.url}:${request.status}`;
        const existing = errorMap.get(key);
        
        if (existing) {
          existing.count++;
          existing.lastOccurrence = Math.max(existing.lastOccurrence, request.startTime);
        } else {
          errorMap.set(key, {
            url: request.url,
            method: request.method,
            status: request.status || 0,
            count: 1,
            lastOccurrence: request.startTime,
          });
        }
      }
    }

    return Array.from(errorMap.values()).sort((a, b) => b.count - a.count);
  }

  getPerformanceStats(): {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    average: number;
    min: number;
    max: number;
  } {
    const durations = this.requestHistory
      .filter(r => r.duration)
      .map(r => r.duration!)
      .sort((a, b) => a - b);

    if (durations.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0, average: 0, min: 0, max: 0 };
    }

    const p50 = this.percentile(durations, 0.5);
    const p90 = this.percentile(durations, 0.9);
    const p95 = this.percentile(durations, 0.95);
    const p99 = this.percentile(durations, 0.99);
    const average = durations.reduce((a, b) => a + b, 0) / durations.length;
    const min = durations[0];
    const max = durations[durations.length - 1];

    return { p50, p90, p95, p99, average, min, max };
  }

  clearHistory(): void {
    this.requestHistory = [];
    this.serviceMetrics.clear();
    this.globalMetrics = this.initializeGlobalMetrics();
  }

  // Private methods
  private findRequestMetrics(requestId: string): RequestMetrics | undefined {
    return this.requestHistory.find(r => r.requestId === requestId);
  }

  private updateServiceMetrics(
    serviceName: string | undefined,
    metrics: RequestMetrics,
    success: boolean
  ): void {
    if (!serviceName) return;

    let serviceMetric = this.serviceMetrics.get(serviceName);
    if (!serviceMetric) {
      serviceMetric = this.initializeServiceMetrics(serviceName);
      this.serviceMetrics.set(serviceName, serviceMetric);
    }

    serviceMetric.totalRequests++;
    if (success) {
      serviceMetric.successfulRequests++;
    } else {
      serviceMetric.failedRequests++;
    }

    if (metrics.duration) {
      serviceMetric.averageResponseTime = 
        (serviceMetric.averageResponseTime * (serviceMetric.totalRequests - 1) + metrics.duration) / 
        serviceMetric.totalRequests;
    }

    serviceMetric.lastRequestTime = metrics.startTime;
    serviceMetric.errorRate = serviceMetric.failedRequests / serviceMetric.totalRequests;
    serviceMetric.retryRate = this.calculateRetryRate(serviceName);
    serviceMetric.cacheHitRate = this.calculateCacheHitRate(serviceName);
  }

  private updateGlobalMetrics(metrics: RequestMetrics, success: boolean): void {
    this.globalMetrics.totalRequests++;
    if (!success) {
      this.globalMetrics.totalErrors++;
    }

    if (metrics.duration) {
      this.globalMetrics.averageResponseTime = 
        (this.globalMetrics.averageResponseTime * (this.globalMetrics.totalRequests - 1) + metrics.duration) / 
        this.globalMetrics.totalRequests;
    }

    this.globalMetrics.errorRate = this.globalMetrics.totalErrors / this.globalMetrics.totalRequests;
    this.globalMetrics.retryRate = this.globalMetrics.totalRetries / this.globalMetrics.totalRequests;
    this.globalMetrics.cacheHitRate = this.globalMetrics.totalCacheHits / this.globalMetrics.totalRequests;
    this.globalMetrics.uptime = Date.now() - this.startTime;
  }

  private calculateGlobalMetrics(): GlobalMetrics {
    const services: Record<string, ServiceMetrics> = {};
    for (const [name, metrics] of this.serviceMetrics) {
      services[name] = { ...metrics };
    }

    return {
      ...this.globalMetrics,
      services,
    };
  }

  private initializeGlobalMetrics(): GlobalMetrics {
    return {
      totalRequests: 0,
      totalErrors: 0,
      totalRetries: 0,
      totalCacheHits: 0,
      averageResponseTime: 0,
      errorRate: 0,
      retryRate: 0,
      cacheHitRate: 0,
      uptime: 0,
      services: {},
    };
  }

  private initializeServiceMetrics(serviceName: string): ServiceMetrics {
    return {
      serviceName,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      errorRate: 0,
      retryRate: 0,
      cacheHitRate: 0,
    };
  }

  private calculateRetryRate(serviceName: string): number {
    const serviceRequests = this.requestHistory.filter(r => 
      this.getServiceNameFromUrl(r.url) === serviceName
    );
    const retriedRequests = serviceRequests.filter(r => r.retryCount > 0);
    return serviceRequests.length > 0 ? retriedRequests.length / serviceRequests.length : 0;
  }

  private calculateCacheHitRate(serviceName: string): number {
    const serviceRequests = this.requestHistory.filter(r => 
      this.getServiceNameFromUrl(r.url) === serviceName
    );
    const cachedRequests = serviceRequests.filter(r => r.cacheHit);
    return serviceRequests.length > 0 ? cachedRequests.length / serviceRequests.length : 0;
  }

  private getServiceNameFromUrl(url: string): string | undefined {
    // Extract service name from URL (this is a simple implementation)
    const match = url.match(/\/api\/([^\/]+)/);
    return match ? match[1] : undefined;
  }

  private percentile(sortedArray: number[], p: number): number {
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }

  private enforceMaxHistorySize(): void {
    if (this.requestHistory.length > this.config.maxHistorySize) {
      this.requestHistory = this.requestHistory.slice(-this.config.maxHistorySize);
    }
  }

  private startExportTimer(): void {
    if (this.config.exportInterval && this.config.exporters) {
      this.exportTimer = setInterval(async () => {
        const metrics = this.getMetrics();
        for (const exporter of this.config.exporters!) {
          try {
            await exporter.export(metrics);
          } catch (error) {
            console.error(`Error exporting metrics to ${exporter.name}:`, error);
          }
        }
      }, this.config.exportInterval);
    }
  }

  updateConfig(newConfig: Partial<MetricsConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
    }
    this.startExportTimer();
  }

  destroy(): void {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
    }
    this.clearHistory();
  }
}

// Built-in exporters
export class ConsoleExporter implements MetricsExporter {
  name = 'console';

  async export(metrics: MetricsData): Promise<void> {
    console.log('📊 Metrics Export:', {
      global: metrics.global,
      requestCount: metrics.requests.length,
      timestamp: new Date(metrics.timestamp).toISOString(),
    });
  }
}

export class SentryExporter implements MetricsExporter {
  name = 'sentry';

  async export(metrics: MetricsData): Promise<void> {
    // This would integrate with Sentry
    console.log('Sentry metrics export:', metrics);
  }
}

export class PrometheusExporter implements MetricsExporter {
  name = 'prometheus';

  async export(metrics: MetricsData): Promise<void> {
    // This would format metrics for Prometheus
    console.log('Prometheus metrics export:', metrics);
  }
}

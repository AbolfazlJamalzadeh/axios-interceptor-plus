import { AxiosRequestConfig, AxiosResponse } from 'axios';

export type TransportType = 'axios' | 'fetch' | 'graphql' | 'websocket';

export interface TransportConfig {
  type: TransportType;
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
}

export interface GraphQLConfig extends TransportConfig {
  type: 'graphql';
  endpoint: string;
  subscriptions?: boolean;
}

export interface WebSocketConfig extends TransportConfig {
  type: 'websocket';
  url: string;
  protocols?: string[];
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface TransportAdapter {
  name: string;
  execute(config: AxiosRequestConfig): Promise<AxiosResponse>;
  isSupported(): boolean;
  destroy?(): void;
}

export class AxiosTransport implements TransportAdapter {
  name = 'axios';
  private axios: any;

  constructor(axiosInstance: any) {
    this.axios = axiosInstance;
  }

  async execute(config: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.axios(config);
  }

  isSupported(): boolean {
    return true; // Axios is always supported
  }
}

export class FetchTransport implements TransportAdapter {
  name = 'fetch';

  async execute(config: AxiosRequestConfig): Promise<AxiosResponse> {
    if (typeof fetch === 'undefined') {
      throw new Error('Fetch is not supported in this environment');
    }

    const url = new URL(config.url!, config.baseURL);
    
    // Add query parameters
    if (config.params) {
      Object.entries(config.params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    const fetchConfig: RequestInit = {
      method: config.method?.toUpperCase() || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers as Record<string, string>),
      },
      signal: config.signal as AbortSignal | null | undefined,
    };

    if (config.data) {
      if (config.data instanceof FormData) {
        fetchConfig.body = config.data;
        delete (fetchConfig.headers as any)['Content-Type'];
      } else {
        fetchConfig.body = JSON.stringify(config.data);
      }
    }

    const response = await fetch(url.toString(), fetchConfig);
    
    // Convert fetch response to axios-like response
    const data = await response.json().catch(() => response.text());
    
    return {
      data,
      status: response.status,
      statusText: response.statusText,
      headers: this.convertHeaders(response.headers),
      config,
    } as AxiosResponse;
  }

  isSupported(): boolean {
    return typeof fetch !== 'undefined';
  }

  private convertHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}

export class GraphQLTransport implements TransportAdapter {
  name = 'graphql';
  private config: GraphQLConfig;

  constructor(config: GraphQLConfig) {
    this.config = config;
  }

  async execute(requestConfig: AxiosRequestConfig): Promise<AxiosResponse> {
    const { query, variables, operationName } = requestConfig.data as any;
    
    const body = {
      query,
      variables,
      operationName,
    };

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.headers as Record<string, string>),
        ...(requestConfig.headers as Record<string, string>),
      },
      body: JSON.stringify(body),
      signal: requestConfig.signal as AbortSignal | null | undefined,
    });

    const data = await response.json();
    
    return {
      data,
      status: response.status,
      statusText: response.statusText,
      headers: this.convertHeaders(response.headers),
      config: requestConfig,
    } as AxiosResponse;
  }

  isSupported(): boolean {
    return typeof fetch !== 'undefined';
  }

  private convertHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}

export class WebSocketTransport implements TransportAdapter {
  name = 'websocket';
  private config: WebSocketConfig;
  private ws?: WebSocket;
  private messageQueue: Array<{ resolve: Function; reject: Function; message: any }> = [];
  private reconnectAttempts = 0;

  constructor(config: WebSocketConfig) {
    this.config = config;
  }

  async execute(requestConfig: AxiosRequestConfig): Promise<AxiosResponse> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.connect();
      }

      const message = {
        id: this.generateId(),
        type: 'request',
        data: requestConfig.data,
        url: requestConfig.url,
        method: requestConfig.method,
      };

      this.messageQueue.push({ resolve, reject, message });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
      }

      // Set timeout
      setTimeout(() => {
        const index = this.messageQueue.findIndex(item => item.message.id === message.id);
        if (index > -1) {
          this.messageQueue.splice(index, 1);
          reject(new Error('WebSocket request timeout'));
        }
      }, requestConfig.timeout || 30000);
    });
  }

  isSupported(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  private connect(): void {
    this.ws = new WebSocket(this.config.url, this.config.protocols);
    
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.processMessageQueue();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      this.handleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private handleMessage(data: any): void {
    const index = this.messageQueue.findIndex(item => item.message.id === data.id);
    if (index > -1) {
      const { resolve } = this.messageQueue[index];
      this.messageQueue.splice(index, 1);
      
      resolve({
        data: data.data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      } as AxiosResponse);
    }
  }

  private processMessageQueue(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.messageQueue.forEach(({ message }) => {
        this.ws!.send(JSON.stringify(message));
      });
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts < (this.config.maxReconnectAttempts || 5)) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connect();
      }, this.config.reconnectInterval || 5000);
    } else {
      // Reject all pending requests
      this.messageQueue.forEach(({ reject }) => {
        reject(new Error('WebSocket connection failed'));
      });
      this.messageQueue = [];
    }
  }

  private generateId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  destroy(): void {
    if (this.ws) {
      this.ws.close();
    }
    this.messageQueue.forEach(({ reject }) => {
      reject(new Error('WebSocket transport destroyed'));
    });
    this.messageQueue = [];
  }
}

export class TransportManager {
  private adapters: Map<TransportType, TransportAdapter> = new Map();
  private defaultTransport: TransportType = 'axios';

  constructor() {
    // Register default transports
    this.registerTransport('fetch', new FetchTransport());
  }

  registerTransport(type: TransportType, adapter: TransportAdapter): void {
    if (adapter.isSupported()) {
      this.adapters.set(type, adapter);
    } else {
      console.warn(`Transport ${type} is not supported in this environment`);
    }
  }

  setDefaultTransport(type: TransportType): boolean {
    if (this.adapters.has(type)) {
      this.defaultTransport = type;
      return true;
    }
    return false;
  }

  getTransport(type?: TransportType): TransportAdapter | null {
    const transportType = type || this.defaultTransport;
    return this.adapters.get(transportType) || null;
  }

  async executeRequest(
    config: AxiosRequestConfig,
    transportType?: TransportType
  ): Promise<AxiosResponse> {
    const transport = this.getTransport(transportType);
    if (!transport) {
      throw new Error(`Transport ${transportType || this.defaultTransport} not available`);
    }

    return transport.execute(config);
  }

  getAvailableTransports(): TransportType[] {
    return Array.from(this.adapters.keys());
  }

  destroy(): void {
    for (const adapter of this.adapters.values()) {
      if (adapter.destroy) {
        adapter.destroy();
      }
    }
    this.adapters.clear();
  }
}

import { AxiosRequestConfig, AxiosResponse } from 'axios';

export type CacheStorage = 'memory' | 'localStorage' | 'indexedDB';

export interface CacheConfig {
  enabled: boolean;
  storage: CacheStorage;
  ttl: number; // Time to live in milliseconds
  maxSize: number; // Maximum number of cached items
  keyGenerator?: (config: AxiosRequestConfig) => string;
  shouldCache?: (response: AxiosResponse) => boolean;
  offlineFirst?: boolean;
}

export interface CacheEntry {
  key: string;
  data: AxiosResponse;
  timestamp: number;
  ttl: number;
  etag?: string;
  lastModified?: string;
}

export class CacheManager {
  private memoryCache: Map<string, CacheEntry> = new Map();
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.config = config;
    this.startCleanupInterval();
  }

  async get(key: string): Promise<AxiosResponse | null> {
    if (!this.config.enabled) {
      return null;
    }

    const entry = await this.getEntry(key);
    if (!entry) {
      return null;
    }

    // Check if entry is expired
    if (this.isExpired(entry)) {
      await this.delete(key);
      return null;
    }

    return entry.data;
  }

  async set(key: string, response: AxiosResponse): Promise<void> {
    if (!this.config.enabled || !this.shouldCache(response)) {
      return;
    }

    const entry: CacheEntry = {
      key,
      data: response,
      timestamp: Date.now(),
      ttl: this.config.ttl,
      etag: response.headers.etag,
      lastModified: response.headers['last-modified'],
    };

    await this.setEntry(key, entry);
    this.enforceMaxSize();
  }

  async delete(key: string): Promise<void> {
    switch (this.config.storage) {
      case 'memory':
        this.memoryCache.delete(key);
        break;
      case 'localStorage':
        if (typeof window !== 'undefined') {
          localStorage.removeItem(`cache_${key}`);
        }
        break;
      case 'indexedDB':
        await this.deleteFromIndexedDB(key);
        break;
    }
  }

  async clear(): Promise<void> {
    switch (this.config.storage) {
      case 'memory':
        this.memoryCache.clear();
        break;
      case 'localStorage':
        if (typeof window !== 'undefined') {
          const keys = Object.keys(localStorage).filter(key => key.startsWith('cache_'));
          keys.forEach(key => localStorage.removeItem(key));
        }
        break;
      case 'indexedDB':
        await this.clearIndexedDB();
        break;
    }
  }

  async invalidate(pattern: string): Promise<void> {
    const keys = await this.getKeys();
    const regex = new RegExp(pattern);
    
    for (const key of keys) {
      if (regex.test(key)) {
        await this.delete(key);
      }
    }
  }

  async getStats(): Promise<{
    size: number;
    hitRate: number;
    missRate: number;
    storage: CacheStorage;
  }> {
    const keys = await this.getKeys();
    return {
      size: keys.length,
      hitRate: 0, // Would be calculated from actual usage
      missRate: 0, // Would be calculated from actual usage
      storage: this.config.storage,
    };
  }

  private async getEntry(key: string): Promise<CacheEntry | null> {
    switch (this.config.storage) {
      case 'memory':
        return this.memoryCache.get(key) || null;
      case 'localStorage':
        if (typeof window !== 'undefined') {
          const item = localStorage.getItem(`cache_${key}`);
          return item ? JSON.parse(item) : null;
        }
        return null;
      case 'indexedDB':
        return await this.getFromIndexedDB(key);
      default:
        return null;
    }
  }

  private async setEntry(key: string, entry: CacheEntry): Promise<void> {
    switch (this.config.storage) {
      case 'memory':
        this.memoryCache.set(key, entry);
        break;
      case 'localStorage':
        if (typeof window !== 'undefined') {
          localStorage.setItem(`cache_${key}`, JSON.stringify(entry));
        }
        break;
      case 'indexedDB':
        await this.setInIndexedDB(key, entry);
        break;
    }
  }

  private async getKeys(): Promise<string[]> {
    switch (this.config.storage) {
      case 'memory':
        return Array.from(this.memoryCache.keys());
      case 'localStorage':
        if (typeof window !== 'undefined') {
          return Object.keys(localStorage)
            .filter(key => key.startsWith('cache_'))
            .map(key => key.replace('cache_', ''));
        }
        return [];
      case 'indexedDB':
        return await this.getKeysFromIndexedDB();
      default:
        return [];
    }
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private shouldCache(response: AxiosResponse): boolean {
    if (this.config.shouldCache) {
      return this.config.shouldCache(response);
    }

    // Default cache strategy
    return response.status >= 200 && response.status < 300;
  }

  private enforceMaxSize(): void {
    if (this.memoryCache.size > this.config.maxSize) {
      // Remove oldest entries
      const entries = Array.from(this.memoryCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = entries.slice(0, this.memoryCache.size - this.config.maxSize);
      toRemove.forEach(([key]) => this.memoryCache.delete(key));
    }
  }

  private startCleanupInterval(): void {
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60000); // Cleanup every minute
  }

  private async cleanupExpiredEntries(): Promise<void> {
    const keys = await this.getKeys();
    for (const key of keys) {
      const entry = await this.getEntry(key);
      if (entry && this.isExpired(entry)) {
        await this.delete(key);
      }
    }
  }

  // IndexedDB methods
  private async getFromIndexedDB(key: string): Promise<CacheEntry | null> {
    if (typeof window === 'undefined') return null;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('axios-cache', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['cache'], 'readonly');
        const store = transaction.objectStore('cache');
        const getRequest = store.get(key);
        
        getRequest.onsuccess = () => resolve(getRequest.result || null);
        getRequest.onerror = () => reject(getRequest.error);
      };
      
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
      };
    });
  }

  private async setInIndexedDB(key: string, entry: CacheEntry): Promise<void> {
    if (typeof window === 'undefined') return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('axios-cache', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['cache'], 'readwrite');
        const store = transaction.objectStore('cache');
        const putRequest = store.put(entry);
        
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };
      
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
      };
    });
  }

  private async deleteFromIndexedDB(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('axios-cache', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['cache'], 'readwrite');
        const store = transaction.objectStore('cache');
        const deleteRequest = store.delete(key);
        
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      };
    });
  }

  private async clearIndexedDB(): Promise<void> {
    if (typeof window === 'undefined') return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('axios-cache', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['cache'], 'readwrite');
        const store = transaction.objectStore('cache');
        const clearRequest = store.clear();
        
        clearRequest.onsuccess = () => resolve();
        clearRequest.onerror = () => reject(clearRequest.error);
      };
    });
  }

  private async getKeysFromIndexedDB(): Promise<string[]> {
    if (typeof window === 'undefined') return [];
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('axios-cache', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['cache'], 'readonly');
        const store = transaction.objectStore('cache');
        const getAllKeysRequest = store.getAllKeys();
        
        getAllKeysRequest.onsuccess = () => resolve(getAllKeysRequest.result as string[]);
        getAllKeysRequest.onerror = () => reject(getAllKeysRequest.error);
      };
    });
  }

  updateConfig(newConfig: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

import { AxiosRequestConfig, AxiosError } from 'axios';
import { AuthConfig } from '../types';

export class AuthHandler {
  private config: AuthConfig;
  private isRefreshing = false;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  async addAuthHeader(config: AxiosRequestConfig): Promise<AxiosRequestConfig> {
    if (!this.config.enabled) {
      return config;
    }

    try {
      const token = await this.getToken();
      if (token) {
        config.headers = {
          ...config.headers,
          Authorization: `${this.config.tokenPrefix} ${token}`,
        };
      }
    } catch (error) {
      console.warn('Failed to add auth header:', error);
    }

    return config;
  }

  async handleAuthError(error: AxiosError): Promise<AxiosError> {
    if (!this.config.enabled || !error.response) {
      return error;
    }

    const status = error.response.status;

    if (status === 401) {
      await this.handleUnauthorized();
    } else if (status === 403) {
      await this.handleForbidden();
    }

    return error;
  }

  private async getToken(): Promise<string | null> {
    if (this.config.getToken) {
      return await this.config.getToken();
    }

    // Default implementation for browser environment
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(this.config.tokenKey);
    }

    return null;
  }

  private async setToken(token: string): Promise<void> {
    if (this.config.setToken) {
      await this.config.setToken(token);
      return;
    }

    // Default implementation for browser environment
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.config.tokenKey, token);
    }
  }

  private async removeToken(): Promise<void> {
    if (this.config.removeToken) {
      await this.config.removeToken();
      return;
    }

    // Default implementation for browser environment
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(this.config.tokenKey);
    }
  }

  private async handleUnauthorized(): Promise<void> {
    if (this.config.refreshToken?.enabled && !this.isRefreshing) {
      try {
        const newToken = await this.refreshToken();
        if (newToken) {
          await this.setToken(newToken);
          return;
        }
      } catch (error) {
        console.warn('Token refresh failed:', error);
      }
    }

    // If refresh failed or not enabled, handle token expiration
    if (this.config.onTokenExpired) {
      await this.config.onTokenExpired();
    } else {
      await this.removeToken();
    }
  }

  private async handleForbidden(): Promise<void> {
    if (this.config.onUnauthorized) {
      await this.config.onUnauthorized();
    }
  }

  private async refreshToken(): Promise<string | null> {
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = this.performTokenRefresh();

    try {
      const newToken = await this.refreshPromise;
      return newToken;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  private async performTokenRefresh(): Promise<string | null> {
    if (!this.config.refreshToken) {
      return null;
    }

    try {
      const refreshToken = await this.getRefreshToken();
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      // This would typically make an API call to refresh the token
      // For now, we'll just return null as the actual implementation
      // would depend on your specific refresh endpoint
      const response = await fetch(this.config.refreshToken.refreshEndpoint || '/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const data = await response.json();
      const newToken = data.accessToken || data.token;

      if (this.config.refreshToken.onRefreshSuccess) {
        await this.config.refreshToken.onRefreshSuccess(newToken);
      }

      return newToken;
    } catch (error) {
      if (this.config.refreshToken.onRefreshFailed) {
        await this.config.refreshToken.onRefreshFailed();
      }
      throw error;
    }
  }

  private async getRefreshToken(): Promise<string | null> {
    if (this.config.refreshToken?.getRefreshToken) {
      return await this.config.refreshToken.getRefreshToken();
    }

    // Default implementation for browser environment
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(`${this.config.tokenKey}_refresh`);
    }

    return null;
  }

  updateConfig(newConfig: Partial<AuthConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

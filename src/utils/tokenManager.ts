import { AxiosRequestConfig } from 'axios';

export interface TokenConfig {
  accessToken: string;
  refreshToken?: string;
  apiKey?: string;
  expiresAt?: number;
  tokenType?: string;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  scope?: string[];
  responseType?: 'code' | 'token';
  grantType?: 'authorization_code' | 'client_credentials' | 'password' | 'refresh_token';
  pkce?: {
    enabled: boolean;
    codeVerifier: string;
    codeChallenge: string;
    codeChallengeMethod: 'S256' | 'plain';
  };
}

export interface MultiTokenConfig {
  tokens: Map<string, TokenConfig>;
  primaryToken: string;
  fallbackTokens: string[];
  rotationStrategy: 'round_robin' | 'priority' | 'failover';
}

export interface TokenRotationConfig {
  enabled: boolean;
  strategy: 'time_based' | 'usage_based' | 'error_based';
  rotationInterval?: number; // milliseconds
  maxUsageCount?: number;
  errorThreshold?: number;
  onTokenRotated?: (oldToken: string, newToken: string) => void;
}

export class TokenManager {
  private tokens: Map<string, TokenConfig> = new Map();
  private primaryToken: string = 'default';
  private fallbackTokens: string[] = [];
  private rotationStrategy: 'round_robin' | 'priority' | 'failover' = 'priority';
  private rotationConfig: TokenRotationConfig;
  private usageCounts: Map<string, number> = new Map();
  private errorCounts: Map<string, number> = new Map();
  private rotationTimer?: NodeJS.Timeout;

  constructor(rotationConfig: TokenRotationConfig) {
    this.rotationConfig = rotationConfig;
    this.startRotationTimer();
  }

  addToken(name: string, config: TokenConfig): void {
    this.tokens.set(name, config);
    this.usageCounts.set(name, 0);
    this.errorCounts.set(name, 0);
  }

  removeToken(name: string): boolean {
    const removed = this.tokens.delete(name);
    this.usageCounts.delete(name);
    this.errorCounts.delete(name);
    
    if (this.primaryToken === name) {
      this.primaryToken = this.tokens.keys().next().value || 'default';
    }
    
    this.fallbackTokens = this.fallbackTokens.filter(token => token !== name);
    return removed;
  }

  setPrimaryToken(name: string): boolean {
    if (this.tokens.has(name)) {
      this.primaryToken = name;
      return true;
    }
    return false;
  }

  addFallbackToken(name: string): boolean {
    if (this.tokens.has(name) && !this.fallbackTokens.includes(name)) {
      this.fallbackTokens.push(name);
      return true;
    }
    return false;
  }

  getToken(name?: string): TokenConfig | null {
    const tokenName = name || this.primaryToken;
    return this.tokens.get(tokenName) || null;
  }

  getValidToken(): TokenConfig | null {
    // Try primary token first
    const primary = this.getToken(this.primaryToken);
    if (primary && this.isTokenValid(primary)) {
      this.incrementUsage(this.primaryToken);
      return primary;
    }

    // Try fallback tokens
    for (const fallbackName of this.fallbackTokens) {
      const fallback = this.getToken(fallbackName);
      if (fallback && this.isTokenValid(fallback)) {
        this.incrementUsage(fallbackName);
        return fallback;
      }
    }

    return null;
  }

  async refreshToken(tokenName: string): Promise<TokenConfig | null> {
    const token = this.getToken(tokenName);
    if (!token || !token.refreshToken) {
      return null;
    }

    try {
      // This would make an actual refresh request
      const newToken = await this.performTokenRefresh(token);
      this.tokens.set(tokenName, newToken);
      this.resetUsage(tokenName);
      this.resetErrors(tokenName);
      
      if (this.rotationConfig.onTokenRotated) {
        this.rotationConfig.onTokenRotated(token.accessToken, newToken.accessToken);
      }
      
      return newToken;
    } catch (error) {
      this.incrementErrors(tokenName);
      throw error;
    }
  }

  async rotateToken(): Promise<TokenConfig | null> {
    if (!this.rotationConfig.enabled) {
      return null;
    }

    const currentToken = this.getValidToken();
    if (!currentToken) {
      return null;
    }

    const currentName = this.getCurrentTokenName();
    if (!currentName) {
      return null;
    }

    switch (this.rotationStrategy) {
      case 'round_robin':
        return this.rotateRoundRobin();
      case 'priority':
        return this.rotateByPriority();
      case 'failover':
        return this.rotateByFailover();
      default:
        return null;
    }
  }

  addAuthHeader(config: AxiosRequestConfig, tokenName?: string): AxiosRequestConfig {
    const token = this.getValidToken();
    if (!token) {
      return config;
    }

    const authHeader = this.buildAuthHeader(token);
    config.headers = {
      ...config.headers,
      ...authHeader,
    };

    return config;
  }

  // OAuth2 Flow Methods
  generateAuthUrl(oauth2Config: OAuth2Config): string {
    const params = new URLSearchParams({
      client_id: oauth2Config.clientId,
      redirect_uri: oauth2Config.redirectUri || '',
      response_type: oauth2Config.responseType || 'code',
      scope: oauth2Config.scope?.join(' ') || '',
    });

    if (oauth2Config.pkce?.enabled) {
      params.set('code_challenge', oauth2Config.pkce.codeChallenge);
      params.set('code_challenge_method', oauth2Config.pkce.codeChallengeMethod);
    }

    return `https://oauth.example.com/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(
    code: string,
    oauth2Config: OAuth2Config
  ): Promise<TokenConfig> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: oauth2Config.clientId,
      code,
      redirect_uri: oauth2Config.redirectUri || '',
    });

    if (oauth2Config.clientSecret) {
      params.set('client_secret', oauth2Config.clientSecret);
    }

    if (oauth2Config.pkce?.enabled) {
      params.set('code_verifier', oauth2Config.pkce.codeVerifier);
    }

    // This would make an actual OAuth2 token exchange request
    const response = await fetch('https://oauth.example.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + (data.expires_in * 1000) : undefined,
      tokenType: data.token_type || 'Bearer',
    };
  }

  // Private methods
  private isTokenValid(token: TokenConfig): boolean {
    if (!token.expiresAt) {
      return true; // No expiration
    }
    return Date.now() < token.expiresAt;
  }

  private incrementUsage(tokenName: string): void {
    const current = this.usageCounts.get(tokenName) || 0;
    this.usageCounts.set(tokenName, current + 1);
  }

  private incrementErrors(tokenName: string): void {
    const current = this.errorCounts.get(tokenName) || 0;
    this.errorCounts.set(tokenName, current + 1);
  }

  private resetUsage(tokenName: string): void {
    this.usageCounts.set(tokenName, 0);
  }

  private resetErrors(tokenName: string): void {
    this.errorCounts.set(tokenName, 0);
  }

  private getCurrentTokenName(): string | null {
    for (const [name, token] of this.tokens) {
      if (this.isTokenValid(token)) {
        return name;
      }
    }
    return null;
  }

  private async rotateRoundRobin(): Promise<TokenConfig | null> {
    const tokenNames = Array.from(this.tokens.keys());
    const currentIndex = tokenNames.indexOf(this.primaryToken);
    const nextIndex = (currentIndex + 1) % tokenNames.length;
    const nextTokenName = tokenNames[nextIndex];
    
    this.primaryToken = nextTokenName;
    return this.getToken(nextTokenName);
  }

  private async rotateByPriority(): Promise<TokenConfig | null> {
    // Sort tokens by usage count (ascending) and error count (ascending)
    const sortedTokens = Array.from(this.tokens.entries())
      .sort((a, b) => {
        const aUsage = this.usageCounts.get(a[0]) || 0;
        const bUsage = this.usageCounts.get(b[0]) || 0;
        const aErrors = this.errorCounts.get(a[0]) || 0;
        const bErrors = this.errorCounts.get(b[0]) || 0;
        
        if (aErrors !== bErrors) {
          return aErrors - bErrors; // Lower error count first
        }
        return aUsage - bUsage; // Lower usage count first
      });

    if (sortedTokens.length > 0) {
      const [name, token] = sortedTokens[0];
      this.primaryToken = name;
      return token;
    }
    
    return null;
  }

  private async rotateByFailover(): Promise<TokenConfig | null> {
    // Try fallback tokens in order
    for (const fallbackName of this.fallbackTokens) {
      const token = this.getToken(fallbackName);
      if (token && this.isTokenValid(token)) {
        this.primaryToken = fallbackName;
        return token;
      }
    }
    
    return null;
  }

  private buildAuthHeader(token: TokenConfig): Record<string, string> {
    const headers: Record<string, string> = {};
    
    if (token.accessToken) {
      const tokenType = token.tokenType || 'Bearer';
      headers.Authorization = `${tokenType} ${token.accessToken}`;
    }
    
    if (token.apiKey) {
      headers['X-API-Key'] = token.apiKey;
    }
    
    return headers;
  }

  private async performTokenRefresh(token: TokenConfig): Promise<TokenConfig> {
    // This would make an actual refresh request
    // For now, we'll simulate it
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ...token,
          accessToken: `refreshed_${token.accessToken}`,
          expiresAt: Date.now() + (3600 * 1000), // 1 hour
        });
      }, 100);
    });
  }

  private startRotationTimer(): void {
    if (!this.rotationConfig.enabled || !this.rotationConfig.rotationInterval) {
      return;
    }

    this.rotationTimer = setInterval(() => {
      this.rotateToken();
    }, this.rotationConfig.rotationInterval);
  }

  // Public methods for monitoring
  getTokenStats(): Record<string, { usage: number; errors: number; valid: boolean }> {
    const stats: Record<string, { usage: number; errors: number; valid: boolean }> = {};
    
    for (const [name, token] of this.tokens) {
      stats[name] = {
        usage: this.usageCounts.get(name) || 0,
        errors: this.errorCounts.get(name) || 0,
        valid: this.isTokenValid(token),
      };
    }
    
    return stats;
  }

  updateConfig(newConfig: Partial<TokenRotationConfig>): void {
    this.rotationConfig = { ...this.rotationConfig, ...newConfig };
    
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }
    
    this.startRotationTimer();
  }

  destroy(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }
  }
}

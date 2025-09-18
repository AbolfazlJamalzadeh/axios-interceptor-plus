import { Logger, LogLevel, LoggingConfig } from '../types';

export class ApiLogger implements Logger {
  private config: LoggingConfig;
  private logLevels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config: LoggingConfig) {
    this.config = config;
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    return this.logLevels[level] >= this.logLevels[this.config.level];
  }

  private sanitizeData(data: any): any {
    if (!data || typeof data !== 'object') return data;

    const sanitized = { ...data };
    
    // Remove sensitive headers
    if (sanitized.headers && this.config.sensitiveHeaders) {
      this.config.sensitiveHeaders.forEach(header => {
        if (sanitized.headers[header]) {
          sanitized.headers[header] = '[REDACTED]';
        }
      });
    }

    // Remove sensitive data keys
    if (this.config.sensitiveDataKeys) {
      this.config.sensitiveDataKeys.forEach(key => {
        if (sanitized[key]) {
          sanitized[key] = '[REDACTED]';
        }
      });
    }

    return sanitized;
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (!this.shouldLog(level)) return;

    const sanitizedData = data ? this.sanitizeData(data) : undefined;
    
    if (this.config.logFunction) {
      this.config.logFunction(level, message, sanitizedData);
    } else {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
      
      switch (level) {
        case 'debug':
          console.debug(logMessage, sanitizedData);
          break;
        case 'info':
          console.info(logMessage, sanitizedData);
          break;
        case 'warn':
          console.warn(logMessage, sanitizedData);
          break;
        case 'error':
          console.error(logMessage, sanitizedData);
          break;
      }
    }
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: any): void {
    this.log('error', message, data);
  }

  updateConfig(newConfig: Partial<LoggingConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

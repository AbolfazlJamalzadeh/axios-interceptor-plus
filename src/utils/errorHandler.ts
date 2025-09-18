import { AxiosError } from 'axios';
import { ErrorConfig } from '../types';
import { ApiLogger } from './logger';

export class ErrorHandler {
  private config: ErrorConfig;
  private logger: ApiLogger;

  constructor(config: ErrorConfig, logger: ApiLogger) {
    this.config = config;
    this.logger = logger;
  }

  async handleError(error: AxiosError): Promise<any> {
    this.logger.error('API Error occurred', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        baseURL: error.config?.baseURL,
      },
    });

    // Call specific error handlers based on error type
    await this.handleSpecificError(error);

    // Call general error handler
    if (this.config.onError) {
      await this.config.onError(error);
    }

    // Transform error if configured
    if (this.config.transformError) {
      return this.config.transformError(error);
    }

    // Show error notification if configured
    if (this.config.showErrorNotifications) {
      this.showErrorNotification(error);
    }

    return Promise.reject(error);
  }

  private async handleSpecificError(error: AxiosError): Promise<void> {
    if (!error.response) {
      // Network error
      if (this.config.onNetworkError) {
        await this.config.onNetworkError(error);
      }
      return;
    }

    const status = error.response.status;

    if (status >= 500) {
      // Server error
      if (this.config.onServerError) {
        await this.config.onServerError(error);
      }
    } else if (status >= 400) {
      // Client error
      if (this.config.onClientError) {
        await this.config.onClientError(error);
      }
    }

    // Check for timeout
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      if (this.config.onTimeoutError) {
        await this.config.onTimeoutError(error);
      }
    }
  }

  private showErrorNotification(error: AxiosError): void {
    if (!this.config.errorNotificationHandler) {
      return;
    }

    let message = 'An error occurred';
    
    if (error.response?.data && typeof error.response.data === 'object' && 'message' in error.response.data) {
      message = (error.response.data as any).message;
    } else if (error.response?.data && typeof error.response.data === 'object' && 'error' in error.response.data) {
      message = (error.response.data as any).error;
    } else if (error.message) {
      message = error.message;
    }

    // Add status code if available
    if (error.response?.status) {
      message = `${message} (${error.response.status})`;
    }

    this.config.errorNotificationHandler(message, error);
  }

  updateConfig(newConfig: Partial<ErrorConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

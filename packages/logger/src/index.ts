export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4,
};

class Logger {
  private currentLevel: LogLevel;
  private prefix: string;

  constructor(prefix: string = '', level?: LogLevel) {
    this.prefix = prefix ? `[${prefix}]` : '';
    this.currentLevel = (level || (process.env.LOG_LEVEL as LogLevel) || 'info') as LogLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.currentLevel];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(7);
    return `${timestamp} ${levelStr} ${this.prefix} ${message}`;
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message));
      if (data) console.error('  ', data);
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message));
      if (data) console.warn('  ', data);
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message));
      if (data && this.currentLevel === 'verbose') console.log('  ', data);
    }
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message));
      if (data) console.log('  ', data);
    }
  }

  verbose(message: string, data?: unknown): void {
    if (this.shouldLog('verbose')) {
      console.log(this.formatMessage('verbose', message));
      if (data) console.log('  ', JSON.stringify(data, null, 2));
    }
  }

  // Convenience methods
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  getLevel(): LogLevel {
    return this.currentLevel;
  }

  // Request/response logging helpers
  logRequest(method: string, url: string, details?: unknown): void {
    if (this.shouldLog('verbose')) {
      this.verbose(`${method} ${url}`, details);
    } else if (this.shouldLog('debug')) {
      this.debug(`${method} ${url}`);
    }
  }

  logResponse(method: string, url: string, status: number, duration: number, details?: unknown): void {
    if (this.shouldLog('verbose')) {
      this.verbose(`${method} ${url} ${status} (${duration}ms)`, details);
    } else if (this.shouldLog('debug')) {
      this.debug(`${method} ${url} ${status} (${duration}ms)`);
    }
  }

  logError(message: string, error: unknown, context?: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    if (this.shouldLog('error')) {
      this.error(`${message}: ${errorMessage}`);
      if (this.shouldLog('verbose') && stack) {
        console.error(stack);
      }
      if (context) {
        this.error(`Context: ${JSON.stringify(context)}`);
      }
    }
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

export function getLogger(prefix?: string): Logger {
  if (!prefix) {
    if (!globalLogger) {
      globalLogger = new Logger();
    }
    return globalLogger;
  }
  return new Logger(prefix);
}

export function setLogLevel(level: LogLevel): void {
  const logger = getLogger();
  logger.setLevel(level);
}

export { Logger };

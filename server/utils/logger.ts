/**
 * Structured logging utilities for better production debugging
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

/**
 * Format log message with timestamp and context
 */
function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const levelUpper = level.toUpperCase();
  
  if (context && Object.keys(context).length > 0) {
    return `[${levelUpper}] ${timestamp} - ${message} ${JSON.stringify(context)}`;
  }
  
  return `[${levelUpper}] ${timestamp} - ${message}`;
}

/**
 * Structured logger with consistent formatting
 */
export const logger = {
  /**
   * Log informational message
   */
  info: (message: string, context?: LogContext) => {
    console.log(formatLog('info', message, context));
  },

  /**
   * Log warning message
   */
  warn: (message: string, context?: LogContext) => {
    console.warn(formatLog('warn', message, context));
  },

  /**
   * Log error message with context
   */
  error: (message: string, context?: LogContext) => {
    console.error(formatLog('error', message, context));
  },

  /**
   * Log debug message (only in development)
   */
  debug: (message: string, context?: LogContext) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(formatLog('debug', message, context));
    }
  },

  /**
   * Log error object with full stack trace
   */
  exception: (message: string, error: Error, context?: LogContext) => {
    console.error(formatLog('error', message, {
      ...context,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack
    }));
  },

  /**
   * Log HTTP request
   */
  request: (method: string, path: string, context?: LogContext) => {
    console.log(formatLog('info', `${method} ${path}`, context));
  },

  /**
   * Log service call (external API, etc.)
   */
  service: (serviceName: string, operation: string, context?: LogContext) => {
    console.log(formatLog('info', `[${serviceName}] ${operation}`, context));
  }
};

/**
 * Create a logger with a specific context prefix
 * Useful for domain-specific logging (e.g., podcast generation, credit system)
 */
export function createLogger(prefix: string) {
  return {
    info: (message: string, context?: LogContext) => 
      logger.info(`[${prefix}] ${message}`, context),
    
    warn: (message: string, context?: LogContext) => 
      logger.warn(`[${prefix}] ${message}`, context),
    
    error: (message: string, context?: LogContext) => 
      logger.error(`[${prefix}] ${message}`, context),
    
    debug: (message: string, context?: LogContext) => 
      logger.debug(`[${prefix}] ${message}`, context),
    
    exception: (message: string, error: Error, context?: LogContext) => 
      logger.exception(`[${prefix}] ${message}`, error, context)
  };
}

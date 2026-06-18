export const logger = {
  info: (message, context = {}) => {
    console.log(`[${new Date().toISOString()}] [INFO] ${message}`, Object.keys(context).length ? JSON.stringify(context) : '');
  },
  warn: (message, context = {}) => {
    console.warn(`[${new Date().toISOString()}] [WARN] ${message}`, Object.keys(context).length ? JSON.stringify(context) : '');
  },
  error: (message, context = {}) => {
    console.error(`[${new Date().toISOString()}] [ERROR] ${message}`, Object.keys(context).length ? JSON.stringify(context) : '');
  },
  debug: (message, context = {}) => {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.log(`[${new Date().toISOString()}] [DEBUG] ${message}`, Object.keys(context).length ? JSON.stringify(context) : '');
    }
  },
  verbose: (message, context = {}) => {
    if (process.env.VERBOSE_LOGGING === 'true') {
      console.log(`[${new Date().toISOString()}] [VERBOSE] ${message}`, Object.keys(context).length ? JSON.stringify(context) : '');
    }
  }
};

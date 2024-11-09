export default defineUnlistedScript(async () => {
});

const config = {
  level: 'debug',
  prefix: '[CookieAudit]',
  enabled: process.env.NODE_ENV !== 'production'
};

export const debug = {
  configure: (options) => {
    Object.assign(config, options);
  },

  log: (...args) => {
    if (!config.enabled) return;
    if (['debug', 'info', 'warn', 'error'].includes(config.level)) {
      console.log(config.prefix, ...args);
    }
  },

  info: (...args) => {
    if (!config.enabled) return;
    if (['info', 'warn', 'error'].includes(config.level)) {
      console.info(config.prefix, ...args);
    }
  },

  warn: (...args) => {
    if (!config.enabled) return;
    if (['warn', 'error'].includes(config.level)) {
      console.warn(config.prefix, ...args);
    }
  },

  error: (...args) => {
    if (!config.enabled) return;
    if (['error'].includes(config.level)) {
      console.error(config.prefix, ...args);
    }
  }
};
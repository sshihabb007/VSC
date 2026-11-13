import { LOG_LEVELS } from './constants.js';

const MAX_BUFFER = 64;

class Logger {
  constructor() {
    this.verbosity = LOG_LEVELS.WARNING;
    this.defaultLevel = LOG_LEVELS.INFO;
    this.ready = false;
    this.buffer = [];
    this.contextStack = [];
  }

  setVerbosity(level) {
    this.verbosity = level;
    this.ready = true;
    if (this.buffer.length > 0) {
      for (const entry of this.buffer) {
        if (entry.level <= this.verbosity) {
          this.emit(entry.level, entry.message);
        }
      }
      this.buffer.length = 0;
    }
  }

  setDefaultLevel(level) {
    this.defaultLevel = level;
  }

  isEnabled(level) {
    if (!this.ready) return level <= LOG_LEVELS.ERROR;
    return level <= this.verbosity;
  }

  pushContext(context) {
    this.contextStack.push(context);
  }

  popContext() {
    this.contextStack.pop();
  }

  generateContext(video) {
    if (!video) return '';
    if (typeof video === 'string') return `[${video}] `;
    if (video.vsc?.controllerId) return `[${video.vsc.controllerId}] `;
    return `[${video.tagName || 'MEDIA'}] `;
  }

  formatMessage(message) {
    if (this.contextStack.length === 0) return message;
    return `${this.generateContext(this.contextStack[this.contextStack.length - 1])}${message}`;
  }

  emit(level, message) {
    const text = typeof message === 'function' ? message() : message;
    const out = `[VSC] ${this.formatMessage(text)}`;
    switch (level) {
      case LOG_LEVELS.ERROR:
        console.error(out);
        break;
      case LOG_LEVELS.WARNING:
        console.warn(out);
        break;
      case LOG_LEVELS.INFO:
        console.info(out);
        break;
      default:
        console.debug(out);
        break;
    }
  }

  log(message, level = this.defaultLevel) {
    if (!this.ready) {
      if (this.buffer.length < MAX_BUFFER) {
        this.buffer.push({ message, level });
      }
      if (level <= LOG_LEVELS.ERROR) {
        this.emit(level, message);
      }
      return;
    }
    if (level <= this.verbosity) {
      this.emit(level, message);
    }
  }

  error(message) {
    if (this.isEnabled(LOG_LEVELS.ERROR)) this.log(message, LOG_LEVELS.ERROR);
  }

  warn(message) {
    if (this.isEnabled(LOG_LEVELS.WARNING)) this.log(message, LOG_LEVELS.WARNING);
  }

  info(message) {
    if (this.isEnabled(LOG_LEVELS.INFO)) this.log(message, LOG_LEVELS.INFO);
  }

  debug(message) {
    if (this.isEnabled(LOG_LEVELS.DEBUG)) this.log(message, LOG_LEVELS.DEBUG);
  }

  verbose(message) {
    if (this.isEnabled(LOG_LEVELS.VERBOSE)) this.log(message, LOG_LEVELS.VERBOSE);
  }

  withContext(context, fn) {
    if (this.verbosity < LOG_LEVELS.DEBUG && this.ready) {
      return fn();
    }
    this.pushContext(context);
    try {
      return fn();
    } finally {
      this.popContext();
    }
  }
}

export const logger = new Logger();

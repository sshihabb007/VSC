import { VideoSpeedExtension } from '../content/inject.js';
import { logger } from '../utils/logger.js';

const GUARD_KEY = Symbol.for('vsc.extension.instance');

if (!window[GUARD_KEY]) {
  const extension = new VideoSpeedExtension();
  window[GUARD_KEY] = extension;
  extension.initialize().catch((error) => {
    logger.error(`Video Speed Controller startup error: ${error.message}`);
  });
}


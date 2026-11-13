import { SPEED_LIMITS, LOG_LEVELS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export const CLASSIFIER_VERDICTS = Object.freeze({
  SELF: 'SELF',
  INIT_NOISE: 'INIT_NOISE',
  USER_INTENT: 'USER_INTENT',
  TEMPORARY_OVERRIDE: 'TEMPORARY_OVERRIDE',
  AUTONOMOUS: 'AUTONOMOUS',
});

export const TARGET_RULES = Object.freeze({
  pointerHoldArms: false,
  spacebarArms: false,
});

export const USER_GESTURE_WINDOW_MS = 300;
export const CLICK_SEQUENCE_WINDOW_MS = 5000;
export const NORMAL_RATE_EPSILON = 0.005;
export const SEEK_RESET_WINDOW_MS = 1000;
export const MEDIA_INIT_GRACE_MS = 2000;
export const TEMPORARY_HOLD_RATE = 2.0;
export const TEMPORARY_HOLD_RATE_EPSILON = 0.01;
export const QUIET_CONTEXT_MS = 5000;
export const LONG_PRESS_CLICK_MS = 400;
export const LONG_PRESS_CLICK_GRACE_MS = 150;
export const UNRESOLVED_BIND_MAX_AGE_MS = 5000;

export function isNativeSpeedShortcutKey(event) {
  if (!event) return false;
  if (event.key === '<' || event.key === '>') return true;
  if (event.shiftKey && (event.keyCode === 188 || event.keyCode === 190)) return true;
  return false;
}

export class IntentClassifier {
  constructor(rules = TARGET_RULES, options = {}) {
    this.rules = { ...TARGET_RULES, ...(rules || {}) };
    this.minRate = options.minRate ?? SPEED_LIMITS.MIN;
    this.lastGestureAt = 0;
    this.lastClickAt = 0;
    this.prevClickAt = 0;
    this.lastInputAt = 0;
    this.longPressEndAt = 0;

    this.clicksByMedia = new WeakMap();
    this.activePointersByMedia = new WeakMap();
    this.activePointerIds = new Set();
    this.pointerOwners = new Map();
    this.spaceHoldActive = false;
    this.spaceHoldMedia = null;

    this.seeksByMedia = new WeakMap();
    this.mediaInitByMedia = new WeakMap();
  }

  updateRules(rules) {
    this.rules = { ...TARGET_RULES, ...(rules || {}) };
  }

  observeInput(event) {
    this.lastInputAt = event.timeStamp;
  }

  observeUnhandledKey(event) {
    this.lastInputAt = event.timeStamp;
    const isSpace = event.code === 'Space' || event.keyCode === 32;
    if (isNativeSpeedShortcutKey(event)) {
      this.lastGestureAt = event.timeStamp;
    }
    if (this.rules.spacebarArms && isSpace) {
      this.spaceHoldActive = true;
      this.spaceHoldMedia ||= this.soleActivePointerMedia();
    }
  }

  observeKeyEnd(event) {
    this.lastInputAt = event.timeStamp;
    const isSpace = event.code === 'Space' || event.keyCode === 32;
    if (!this.rules.spacebarArms || !isSpace || !this.spaceHoldActive) {
      return null;
    }
    const media = this.spaceHoldMedia;
    this.spaceHoldActive = false;
    this.spaceHoldMedia = null;
    return media && !this.hasActiveTemporaryHoldFor(media, event.timeStamp) ? media : null;
  }

  observeClick(event, media = null) {
    this.lastInputAt = event.timeStamp;
    const sinceLongPress = event.timeStamp - this.longPressEndAt;
    if (
      this.longPressEndAt > 0 &&
      sinceLongPress >= 0 &&
      sinceLongPress < LONG_PRESS_CLICK_GRACE_MS
    ) {
      return;
    }
    const ledger = media ? this.getClickLedger(media) : this;
    ledger.prevClickAt = ledger.lastClickAt;
    ledger.lastClickAt = event.timeStamp;
  }

  observeSeek(media, timeStamp) {
    if (media) this.seeksByMedia.set(media, timeStamp);
  }

  observeMediaInit(media, timeStamp) {
    if (media) this.mediaInitByMedia.set(media, timeStamp);
  }

  getClickLedger(media) {
    let ledger = this.clicksByMedia.get(media);
    if (!ledger) {
      ledger = { lastClickAt: 0, prevClickAt: 0 };
      this.clicksByMedia.set(media, ledger);
    }
    return ledger;
  }

  observePointerDown(event, media = null) {
    this.lastInputAt = event.timeStamp;
    if (!this.rules.pointerHoldArms || !Number.isInteger(event.pointerId)) {
      return;
    }
    this.removePointer(event.pointerId);
    const owner = media || (this.spaceHoldActive ? this.spaceHoldMedia : null);
    if (owner) {
      this.getPointerLedger(owner).add(event.pointerId);
    } else {
      this.activePointerIds.add(event.pointerId);
    }
    this.pointerOwners.set(event.pointerId, { media: owner, downAt: event.timeStamp });
  }

  observePointerEnd(event) {
    this.lastInputAt = event.timeStamp;
    if (!this.rules.pointerHoldArms) return [];
    if (!Number.isInteger(event.pointerId)) {
      return this.clearPointerHolds();
    }

    const entry = this.pointerOwners.get(event.pointerId) || null;
    if (entry && event.timeStamp - entry.downAt >= LONG_PRESS_CLICK_MS) {
      this.longPressEndAt = event.timeStamp;
    }
    this.removePointer(event.pointerId);
    const media = entry?.media || null;
    return media && !this.hasActiveTemporaryHoldFor(media, event.timeStamp) ? [media] : [];
  }

  getPointerLedger(media) {
    let ledger = this.activePointersByMedia.get(media);
    if (!ledger) {
      ledger = new Set();
      this.activePointersByMedia.set(media, ledger);
    }
    return ledger;
  }

  removePointer(pointerId) {
    const entry = this.pointerOwners.get(pointerId);
    if (!entry) {
      this.activePointerIds.delete(pointerId);
      return;
    }
    if (entry.media) {
      this.activePointersByMedia.get(entry.media)?.delete(pointerId);
    } else {
      this.activePointerIds.delete(pointerId);
    }
    this.pointerOwners.delete(pointerId);
  }

  clearPointerHolds() {
    const affected = [];
    const seen = new Set();
    this.activePointerIds.clear();
    for (const entry of this.pointerOwners.values()) {
      if (entry.media && !seen.has(entry.media)) {
        seen.add(entry.media);
        affected.push(entry.media);
        this.activePointersByMedia.delete(entry.media);
      }
    }
    this.pointerOwners.clear();
    return affected;
  }

  clearTemporaryHolds() {
    const affected = new Set(this.clearPointerHolds());
    if (this.spaceHoldMedia) {
      affected.add(this.spaceHoldMedia);
    }
    this.spaceHoldActive = false;
    this.spaceHoldMedia = null;
    return [...affected];
  }

  soleActivePointerMedia() {
    let found = null;
    for (const entry of this.pointerOwners.values()) {
      if (!entry.media) continue;
      if (found && found !== entry.media) return null;
      found = entry.media;
    }
    return found;
  }

  isStaleUnresolvedPress(downAt, timeStamp) {
    const age = timeStamp - downAt;
    return age < 0 || age > UNRESOLVED_BIND_MAX_AGE_MS;
  }

  activePointerFor(media, timeStamp) {
    if (media && (this.activePointersByMedia.get(media)?.size ?? 0) > 0) {
      for (const pointerId of this.activePointersByMedia.get(media)) {
        return pointerId;
      }
    }

    if (media && this.activePointerIds.size > 0) {
      let newestId = null;
      let newestAt = -Infinity;
      for (const pointerId of this.activePointerIds) {
        const entry = this.pointerOwners.get(pointerId);
        if (entry && !this.isStaleUnresolvedPress(entry.downAt, timeStamp) && entry.downAt > newestAt) {
          newestAt = entry.downAt;
          newestId = pointerId;
        }
      }
      if (newestId !== null) {
        const entry = this.pointerOwners.get(newestId);
        this.activePointerIds.delete(newestId);
        this.getPointerLedger(media).add(newestId);
        this.pointerOwners.set(newestId, { media, downAt: entry?.downAt ?? timeStamp });
        return newestId;
      }
    }

    if (!media && this.activePointerIds.size > 0) {
      for (const pointerId of this.activePointerIds) {
        const entry = this.pointerOwners.get(pointerId);
        if (entry && !this.isStaleUnresolvedPress(entry.downAt, timeStamp)) {
          return pointerId;
        }
      }
    }

    return null;
  }

  hasActiveTemporaryHoldFor(media, timeStamp) {
    if (!media) return false;
    if (
      (this.activePointersByMedia.get(media)?.size ?? 0) > 0 ||
      (this.spaceHoldActive && (!this.spaceHoldMedia || this.spaceHoldMedia === media))
    ) {
      return true;
    }
    for (const id of this.activePointerIds) {
      if (!this.isStaleUnresolvedPress(this.pointerOwners.get(id)?.downAt ?? 0, timeStamp)) {
        return true;
      }
    }
    return false;
  }

  isTemporaryOverride(ctx) {
    if (
      typeof ctx.rate !== 'number' ||
      Math.abs(ctx.rate - TEMPORARY_HOLD_RATE) > TEMPORARY_HOLD_RATE_EPSILON
    ) {
      return false;
    }
    if (this.rules.pointerHoldArms && this.activePointerFor(ctx.media, ctx.timeStamp) !== null) {
      if (this.spaceHoldActive && !this.spaceHoldMedia) {
        this.spaceHoldMedia = ctx.media || null;
      }
      return true;
    }
    if (
      this.rules.spacebarArms &&
      this.spaceHoldActive &&
      (!this.spaceHoldMedia || this.spaceHoldMedia === ctx.media)
    ) {
      this.spaceHoldMedia = ctx.media || null;
      return true;
    }
    if ((this.rules.pointerHoldArms || this.rules.spacebarArms) && logger.isEnabled(LOG_LEVELS.DEBUG)) {
      logger.debug(
        `Hold-rate ${ctx.rate} without evidence: scoped=${ctx.media ? (this.activePointersByMedia.get(ctx.media)?.size ?? 0) : 'n/a'} unresolved=${this.activePointerIds.size} space=${this.spaceHoldActive}`
      );
    }
    return false;
  }

  intentEvidence(ctx) {
    const ts = ctx.timeStamp;
    const within = (t) => t > 0 && ts - t >= 0 && ts - t < USER_GESTURE_WINDOW_MS;

    const mediaLedger = ctx.media ? this.clicksByMedia.get(ctx.media) : null;
    const docClickIn = within(this.lastClickAt);
    const mediaClickIn = mediaLedger ? within(mediaLedger.lastClickAt) : false;
    const clickInWindow = docClickIn || mediaClickIn;

    const docSeq =
      docClickIn && this.prevClickAt > 0 && this.lastClickAt - this.prevClickAt <= CLICK_SEQUENCE_WINDOW_MS;
    const mediaSeq =
      mediaClickIn &&
      mediaLedger.prevClickAt > 0 &&
      mediaLedger.lastClickAt - mediaLedger.prevClickAt <= CLICK_SEQUENCE_WINDOW_MS;

    const keyIntent = within(this.lastGestureAt);
    return {
      clickInWindow,
      keyIntent,
      strong: keyIntent || docSeq || mediaSeq,
    };
  }

  isSideEffectNormalReset(ctx) {
    if (!ctx.media) return false;
    if (ctx.media.seeking) return true;

    const ts = ctx.timeStamp;
    const seekAt = this.seeksByMedia.get(ctx.media);
    if (typeof seekAt === 'number' && ts - seekAt >= 0 && ts - seekAt < SEEK_RESET_WINDOW_MS) {
      return true;
    }
    const initAt = this.mediaInitByMedia.get(ctx.media);
    if (typeof initAt === 'number' && ts - initAt >= 0 && ts - initAt < MEDIA_INIT_GRACE_MS) {
      return true;
    }
    return false;
  }

  hasStrongIntent(ctx) {
    return this.intentEvidence(ctx).strong;
  }

  classify(ctx) {
    if (ctx.detail && ctx.detail.origin === 'videoSpeed') {
      return CLASSIFIER_VERDICTS.SELF;
    }
    if (ctx.readyState < 1) {
      return CLASSIFIER_VERDICTS.INIT_NOISE;
    }
    if (typeof ctx.rate === 'number' && !isNaN(ctx.rate) && ctx.rate <= this.minRate) {
      return CLASSIFIER_VERDICTS.INIT_NOISE;
    }

    const { clickInWindow, keyIntent, strong } = this.intentEvidence(ctx);
    const isNormalReset = Math.abs(ctx.rate - 1.0) < NORMAL_RATE_EPSILON;

    if (strong) {
      if (isNormalReset && !keyIntent && this.isSideEffectNormalReset(ctx)) {
        return CLASSIFIER_VERDICTS.AUTONOMOUS;
      }
      return CLASSIFIER_VERDICTS.USER_INTENT;
    }
    if (this.isTemporaryOverride(ctx)) {
      return CLASSIFIER_VERDICTS.TEMPORARY_OVERRIDE;
    }
    if (clickInWindow && !isNormalReset) {
      return CLASSIFIER_VERDICTS.USER_INTENT;
    }
    return CLASSIFIER_VERDICTS.AUTONOMOUS;
  }

  isQuietContext(timeStamp) {
    return this.lastInputAt === 0 || timeStamp - this.lastInputAt >= QUIET_CONTEXT_MS;
  }

  clearTemporaryHoldsForMedia(media) {
    // Fixed upstream bug: pointerOwners stores { media, downAt }, not bare media elements
    for (const [pointerId, owner] of [...this.pointerOwners]) {
      if (owner.media === media) {
        this.removePointer(pointerId);
      }
    }
    this.activePointersByMedia.delete(media);
    if (this.spaceHoldMedia === media) {
      this.spaceHoldActive = false;
      this.spaceHoldMedia = null;
    }
  }

  consumeGesture(media = null) {
    this.lastGestureAt = 0;
    this.lastClickAt = 0;
    this.prevClickAt = 0;
    if (media) {
      this.clicksByMedia.delete(media);
      this.clearTemporaryHoldsForMedia(media);
    } else {
      this.clearTemporaryHolds();
    }
  }

  releaseMedia(media) {
    this.clicksByMedia.delete(media);
    this.seeksByMedia.delete(media);
    this.mediaInitByMedia.delete(media);
    this.clearTemporaryHoldsForMedia(media);
  }

  reset() {
    this.lastGestureAt = 0;
    this.lastClickAt = 0;
    this.prevClickAt = 0;
    this.lastInputAt = 0;
    this.longPressEndAt = 0;
    this.clearTemporaryHolds();
    this.clicksByMedia = new WeakMap();
    this.activePointersByMedia = new WeakMap();
    this.seeksByMedia = new WeakMap();
    this.mediaInitByMedia = new WeakMap();
  }
}


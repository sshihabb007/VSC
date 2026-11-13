import { SpeedArbiter } from './arbiter.js';
import { IntentClassifier, CLASSIFIER_VERDICTS } from './intent-classifier.js';
import { LOG_LEVELS, roundSpeed } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export class SpeedArbitration {
  static FIGHT_WINDOW_MS = 3000;
  static ECHO_TOLERANCE = 0.011;
  static ECHO_TTL_MS = 500;
  static ECHO_MAX_PENDING = 8;
  static TEMPORARY_RELEASE_FALLBACK_MS = 250;

  constructor(config, eventManager = null, options = {}) {
    this.config = config;
    this.eventManager = eventManager;
    this.authorityEpoch = 0;

    this.conflicts = new WeakMap();
    this.pendingWrites = new WeakMap();
    this.echoTransactions = new Map();
    this.timedConflicts = new Set();
    this.temporaryReleaseTimers = new WeakMap();
    this.pendingTemporaryReleaseTimers = new Set();

    const rules = options.classifierRules ?? null;
    this.classifier = new IntentClassifier(rules, options.classifierOptions);
  }

  get sharedDesired() {
    const speed = this.config?.settings?.lastSpeed;
    return typeof speed === 'number' && Number.isFinite(speed) ? speed : null;
  }

  updateClassifierRules(rules) {
    this.classifier.updateRules(rules);
  }

  noteWrite(video, rate, options = {}) {
    let queue = this.pendingWrites.get(video);
    if (!queue) {
      queue = [];
      this.pendingWrites.set(video, queue);
    }

    const now = performance.now();
    // Prune stale tokens in-place to keep zero steady-state allocations
    let writeIdx = 0;
    for (let i = 0; i < queue.length; i++) {
      if (now - queue[i].at <= SpeedArbitration.ECHO_TTL_MS) {
        queue[writeIdx++] = queue[i];
      }
    }
    queue.length = writeIdx;

    if (queue.length >= SpeedArbitration.ECHO_MAX_PENDING) {
      queue.shift();
    }

    queue.push({
      rate,
      epoch: this.authorityEpoch,
      at: now,
      suppressPropagation: Boolean(options.suppressPropagation),
    });
  }

  consumeEcho(video, rate) {
    const queue = this.pendingWrites.get(video);
    if (!queue || queue.length === 0) return null;

    const now = performance.now();
    const epoch = this.authorityEpoch;
    let writeIdx = 0;
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      if (entry.epoch === epoch && now - entry.at <= SpeedArbitration.ECHO_TTL_MS) {
        queue[writeIdx++] = entry;
      }
    }
    queue.length = writeIdx;

    const matchIdx = queue.findIndex(
      (entry) => Math.abs(entry.rate - rate) <= SpeedArbitration.ECHO_TOLERANCE
    );
    if (matchIdx === -1) {
      // Drop unmatched hidden retry tokens so they cannot match later external events
      let keepIdx = 0;
      for (let i = 0; i < queue.length; i++) {
        if (!queue[i].suppressPropagation) {
          queue[keepIdx++] = queue[i];
        }
      }
      queue.length = keepIdx;
      return null;
    }

    const matched = queue[matchIdx];
    queue.splice(0, matchIdx + 1);
    return matched;
  }

  observePropagatedEcho(video, event, echo) {
    this.clearEchoTransaction(video);
    const transaction = {
      epoch: echo.epoch,
      expectedRate: echo.rate,
      sourceEvent: event,
      observedRate: null,
      listener: null,
    };

    transaction.listener = (targetEvent) => {
      if (
        targetEvent !== transaction.sourceEvent ||
        this.echoTransactions.get(video) !== transaction
      ) {
        return;
      }
      video.removeEventListener('ratechange', transaction.listener);
      transaction.listener = null;

      if (transaction.epoch !== this.authorityEpoch) {
        this.clearEchoTransaction(video);
        return;
      }

      const observedRate = video.playbackRate;
      if (Math.abs(observedRate - transaction.expectedRate) <= SpeedArbitration.ECHO_TOLERANCE) {
        this.clearEchoTransaction(video);
        return;
      }

      transaction.sourceEvent = null;
      transaction.observedRate = observedRate;
    };

    this.echoTransactions.set(video, transaction);
    video.addEventListener('ratechange', transaction.listener);
  }

  clearEchoTransaction(video) {
    const transaction = this.echoTransactions.get(video);
    if (!transaction) return;
    if (transaction.listener) {
      video.removeEventListener('ratechange', transaction.listener);
      transaction.listener = null;
    }
    this.echoTransactions.delete(video);
  }

  clearAllEchoTransactions() {
    if (this.echoTransactions.size === 0) return;
    for (const [video, transaction] of this.echoTransactions) {
      if (transaction.listener) {
        video.removeEventListener('ratechange', transaction.listener);
        transaction.listener = null;
      }
    }
    this.echoTransactions.clear();
  }

  consumeEchoReaction(video, event) {
    const transaction = this.echoTransactions.get(video);
    if (!transaction) return false;

    if (transaction.epoch !== this.authorityEpoch) {
      this.clearEchoTransaction(video);
      return false;
    }

    if (transaction.observedRate === null) {
      const active =
        transaction.sourceEvent !== event &&
        Number.isFinite(transaction.sourceEvent?.eventPhase) &&
        transaction.sourceEvent.eventPhase !== Event.NONE;
      if (active) return null;
      this.clearEchoTransaction(video);
      return false;
    }

    const matches =
      Math.abs(transaction.observedRate - video.playbackRate) <= SpeedArbitration.ECHO_TOLERANCE;
    this.clearEchoTransaction(video);
    return matches;
  }

  claimAuthority(speed) {
    this.config.persistAuthority(speed);
    this.clearAllEchoTransactions();
    this.authorityEpoch += 1;
    for (const conflict of this.timedConflicts) {
      clearTimeout(conflict.timer);
      conflict.timer = null;
    }
    this.timedConflicts.clear();
  }

  conflictFor(video) {
    const desired = this.sharedDesired;
    if (desired === null) return null;

    let conflict = this.conflicts.get(video);
    if (!conflict || conflict.epoch !== this.authorityEpoch) {
      const temporaryOverride = conflict?.temporaryOverride ?? false;
      this.disarmFightTimer(conflict);
      conflict = {
        epoch: this.authorityEpoch,
        mode: SpeedArbiter.MODES.HOLDING,
        fightCount: 0,
        warQuiet: true,
        rearmBudget: SpeedArbiter.DEFAULT_REARM_BUDGET,
        temporaryOverride,
        timer: null,
      };
      this.conflicts.set(video, conflict);
    }
    return conflict;
  }

  stateFor(video) {
    const desired = this.sharedDesired;
    if (desired === null) {
      return SpeedArbiter.makeState(SpeedArbiter.MODES.NO_OPINION, null, 0);
    }
    const c = this.conflictFor(video);
    return SpeedArbiter.makeState(
      c.mode,
      desired,
      c.fightCount,
      c.warQuiet,
      c.rearmBudget,
      c.temporaryOverride
    );
  }

  commit(video, nextState) {
    if (nextState.mode === SpeedArbiter.MODES.NO_OPINION || nextState.desired === null) {
      const prev = this.conflicts.get(video);
      this.disarmFightTimer(prev);
      this.conflicts.delete(video);
      return;
    }

    let c = this.conflicts.get(video);
    if (!c || c.epoch !== this.authorityEpoch) {
      this.disarmFightTimer(c);
      c = {
        epoch: this.authorityEpoch,
        mode: nextState.mode,
        fightCount: nextState.fightCount,
        warQuiet: nextState.warQuiet,
        rearmBudget: nextState.rearmBudget,
        temporaryOverride: nextState.temporaryOverride,
        timer: null,
      };
      this.conflicts.set(video, c);
    } else {
      c.mode = nextState.mode;
      c.fightCount = nextState.fightCount;
      c.warQuiet = nextState.warQuiet;
      c.rearmBudget = nextState.rearmBudget;
      c.temporaryOverride = nextState.temporaryOverride;
    }
  }

  disarmFightTimer(conflict) {
    if (conflict && conflict.timer !== null) {
      clearTimeout(conflict.timer);
      conflict.timer = null;
      this.timedConflicts.delete(conflict);
    }
  }

  armFightTimer(video, conflict) {
    this.disarmFightTimer(conflict);
    this.timedConflicts.add(conflict);
    const epoch = conflict.epoch;
    conflict.timer = setTimeout(() => {
      conflict.timer = null;
      this.timedConflicts.delete(conflict);
      if (this.conflicts.get(video) !== conflict || this.authorityEpoch !== epoch) {
        return;
      }
      const curState = this.stateFor(video);
      const { state } = SpeedArbiter.step(curState, {
        type: SpeedArbiter.EVENTS.FIGHT_WINDOW_EXPIRE,
      });
      this.commit(video, state);
      if (logger.isEnabled(LOG_LEVELS.DEBUG)) {
        logger.debug('Fight window expired; reset fight counter');
      }
    }, SpeedArbitration.FIGHT_WINDOW_MS);
  }

  clearTemporaryReleaseTimer(video) {
    const entry = this.temporaryReleaseTimers.get(video);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.temporaryReleaseTimers.delete(video);
    this.pendingTemporaryReleaseTimers.delete(entry);
  }

  scheduleTemporaryRelease(video, actionHandler) {
    const c = this.conflictFor(video);
    if (!c?.temporaryOverride) return;

    this.clearTemporaryReleaseTimer(video);
    const epoch = c.epoch;
    const entry = {
      timer: setTimeout(() => {
        if (this.temporaryReleaseTimers.get(video) === entry) {
          this.temporaryReleaseTimers.delete(video);
        }
        this.pendingTemporaryReleaseTimers.delete(entry);

        const activeConflict = this.conflicts.get(video);
        if (!video.isConnected || this.authorityEpoch !== epoch || !activeConflict?.temporaryOverride) {
          return;
        }
        if (this.classifier.hasActiveTemporaryHoldFor(video, performance.now())) {
          return;
        }
        this.completeTemporaryOverride(video, video.playbackRate, null, actionHandler);
      }, SpeedArbitration.TEMPORARY_RELEASE_FALLBACK_MS),
    };
    this.temporaryReleaseTimers.set(video, entry);
    this.pendingTemporaryReleaseTimers.add(entry);
  }

  completeTemporaryOverride(video, rawRate, event, actionHandler) {
    this.clearTemporaryReleaseTimer(video);
    const prev = this.stateFor(video);
    const { state, effects } = SpeedArbiter.step(prev, {
      type: SpeedArbiter.EVENTS.TEMPORARY_OVERRIDE_END,
      speed: rawRate,
    });
    this.commit(video, state);

    let restored = false;
    for (let i = 0; i < effects.length; i++) {
      const fx = effects[i];
      if (fx.type === SpeedArbiter.EFFECTS.WRITE) {
        restored = true;
        actionHandler?.writeRate(video, fx.speed);
      } else if (fx.type === SpeedArbiter.EFFECTS.SYNC_UI) {
        actionHandler?.syncIndicator(video, fx.speed);
      }
    }
    if (restored && event) {
      event.stopImmediatePropagation?.();
    }
  }

  noteUserSet(video, speed, options = {}) {
    const startsEpoch = options.startsAuthorityEpoch !== false;
    if (startsEpoch) {
      this.claimAuthority(speed);
    } else if (this.sharedDesired === null) {
      this.config.persistAuthority(speed);
    }

    const prev = this.stateFor(video);
    const { state } = SpeedArbiter.step(prev, {
      type: SpeedArbiter.EVENTS.USER_SET,
      speed,
    });
    this.clearTemporaryReleaseTimer(video);
    this.commit(video, state);
    this.disarmFightTimer(this.conflicts.get(video));
    return state;
  }

  noteTemporaryOverrideStart(video, rate, actionHandler) {
    this.clearTemporaryReleaseTimer(video);
    const prev = this.stateFor(video);
    const { state, effects } = SpeedArbiter.step(prev, {
      type: SpeedArbiter.EVENTS.TEMPORARY_OVERRIDE_START,
      speed: rate,
    });
    this.commit(video, state);
    for (let i = 0; i < effects.length; i++) {
      if (effects[i].type === SpeedArbiter.EFFECTS.SYNC_UI) {
        actionHandler?.syncIndicator(video, effects[i].speed);
      }
    }
  }

  noteTemporaryOverrideEnd(video) {
    const actionHandler = this.eventManager?.actionHandler;
    if (!actionHandler) return;
    this.scheduleTemporaryRelease(video, actionHandler);
  }

  lifecycleTarget(video) {
    const prev = this.stateFor(video);
    const { state, effects } = SpeedArbiter.step(prev, {
      type: SpeedArbiter.EVENTS.LIFECYCLE,
    });
    this.commit(video, state);
    const writeFx = effects.find((fx) => fx.type === SpeedArbiter.EFFECTS.WRITE);
    return writeFx ? writeFx.speed : null;
  }

  onExternalRate(video, rawRate, verdict, event, actionHandler, options = {}) {
    if (verdict === CLASSIFIER_VERDICTS.SELF || verdict === CLASSIFIER_VERDICTS.INIT_NOISE) {
      return;
    }

    const prev = this.stateFor(video);
    if (verdict === CLASSIFIER_VERDICTS.TEMPORARY_OVERRIDE) {
      this.noteTemporaryOverrideStart(video, rawRate, actionHandler);
      return;
    }

    const releasePending = this.temporaryReleaseTimers.has(video);
    if (
      prev.temporaryOverride &&
      (verdict !== CLASSIFIER_VERDICTS.USER_INTENT || releasePending)
    ) {
      this.completeTemporaryOverride(video, rawRate, event, actionHandler);
      return;
    }

    if (prev.temporaryOverride) {
      this.clearTemporaryReleaseTimer(video);
    }

    let rateClass = SpeedArbiter.RATE_CLASSES.AUTONOMOUS;
    let speedForDecision = rawRate;

    if (verdict === CLASSIFIER_VERDICTS.USER_INTENT) {
      if (
        prev.mode === SpeedArbiter.MODES.HOLDING &&
        prev.desired !== null &&
        Math.abs(rawRate - prev.desired) <= 0.01
      ) {
        speedForDecision = prev.desired;
      } else {
        rateClass = SpeedArbiter.RATE_CLASSES.USER_INTENT;
        speedForDecision = roundSpeed(rawRate);
      }
    }

    if (rateClass === SpeedArbiter.RATE_CLASSES.USER_INTENT) {
      this.claimAuthority(speedForDecision);
      this.classifier.consumeGesture(video);
    }

    const quiet = this.classifier.isQuietContext(event?.timeStamp ?? performance.now());
    const { state, effects } = SpeedArbiter.step(
      rateClass === SpeedArbiter.RATE_CLASSES.USER_INTENT ? this.stateFor(video) : prev,
      {
        type: SpeedArbiter.EVENTS.EXT_RATE,
        speed: speedForDecision,
        rateClass,
        quiet,
      }
    );

    this.commit(video, state);

    const conflict = this.conflicts.get(video);
    if (
      rateClass === SpeedArbiter.RATE_CLASSES.AUTONOMOUS &&
      state.fightCount > prev.fightCount &&
      conflict
    ) {
      this.armFightTimer(video, conflict);
    } else if (
      state.mode === SpeedArbiter.MODES.SUPPRESSED ||
      state.mode === SpeedArbiter.MODES.REARMABLE ||
      rateClass === SpeedArbiter.RATE_CLASSES.USER_INTENT
    ) {
      this.disarmFightTimer(conflict);
    }

    let wroteRetry = false;
    for (let i = 0; i < effects.length; i++) {
      const fx = effects[i];
      if (fx.type === SpeedArbiter.EFFECTS.WRITE) {
        wroteRetry = true;
        actionHandler?.writeRate(video, fx.speed, {
          suppressEchoPropagation: Boolean(options.suppressRetryEcho),
        });
      } else if (fx.type === SpeedArbiter.EFFECTS.SYNC_UI) {
        actionHandler?.syncIndicator(video, fx.speed);
      }
    }

    if (wroteRetry && options.suppressRetryEcho) {
      event?.stopImmediatePropagation?.();
    }
  }

  release(video) {
    this.disarmFightTimer(this.conflicts.get(video));
    this.clearTemporaryReleaseTimer(video);
    this.clearEchoTransaction(video);
    this.conflicts.delete(video);
    this.pendingWrites.delete(video);
    this.classifier.releaseMedia(video);
  }

  cleanup() {
    for (const conflict of this.timedConflicts) {
      clearTimeout(conflict.timer);
      conflict.timer = null;
    }
    this.timedConflicts.clear();

    for (const entry of this.pendingTemporaryReleaseTimers) {
      clearTimeout(entry.timer);
    }
    this.pendingTemporaryReleaseTimers.clear();
    this.temporaryReleaseTimers = new WeakMap();

    this.clearAllEchoTransactions();
    this.conflicts = new WeakMap();
    this.pendingWrites = new WeakMap();
    this.classifier.reset();
  }
}


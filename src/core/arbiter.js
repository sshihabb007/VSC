/**
 * Pure per-media speed arbitration state machine (SpeedArbiter).
 * Machine-checked against specs/SpeedArbiter.tla semantics.
 */

export const MODES = Object.freeze({
  NO_OPINION: 'NO_OPINION',
  HOLDING: 'HOLDING',
  REARMABLE: 'REARMABLE',
  SUPPRESSED: 'SUPPRESSED',
});

export const ARBITER_EVENTS = Object.freeze({
  USER_SET: 'USER_SET',
  TEMPORARY_OVERRIDE_START: 'TEMPORARY_OVERRIDE_START',
  TEMPORARY_OVERRIDE_END: 'TEMPORARY_OVERRIDE_END',
  EXT_RATE: 'EXT_RATE',
  LIFECYCLE: 'LIFECYCLE',
  FIGHT_WINDOW_EXPIRE: 'FIGHT_WINDOW_EXPIRE',
});

export const RATE_CLASSES = Object.freeze({
  USER_INTENT: 'USER_INTENT',
  AUTONOMOUS: 'AUTONOMOUS',
  INIT_NOISE: 'INIT_NOISE',
});

export const ARBITER_EFFECTS = Object.freeze({
  WRITE: 'WRITE',
  PERSIST: 'PERSIST',
  SYNC_UI: 'SYNC_UI',
});

export const DEFAULT_MAX_FIGHT = 4;
export const DEFAULT_REARM_BUDGET = 1;

export function makeState(
  mode,
  desired,
  fightCount,
  warQuiet = true,
  rearmBudget = DEFAULT_REARM_BUDGET,
  temporaryOverride = false
) {
  return {
    mode,
    desired,
    fightCount,
    warQuiet: Boolean(warQuiet),
    rearmBudget: rearmBudget ?? DEFAULT_REARM_BUDGET,
    temporaryOverride: Boolean(temporaryOverride),
  };
}

export function loadState(init) {
  const { siteRuleSpeed = null, rememberedSpeed = null, rememberEnabled = false } = init || {};
  if (siteRuleSpeed !== null && siteRuleSpeed !== undefined) {
    return makeState(MODES.HOLDING, siteRuleSpeed, 0);
  }
  if (rememberEnabled && rememberedSpeed !== null && rememberedSpeed !== undefined) {
    return makeState(MODES.HOLDING, rememberedSpeed, 0);
  }
  return makeState(MODES.NO_OPINION, null, 0);
}

function effect(type, speed) {
  return { type, speed };
}

export function step(state, event, options = {}) {
  const maxFight = options.maxFight ?? DEFAULT_MAX_FIGHT;

  switch (event.type) {
    case ARBITER_EVENTS.USER_SET:
      return {
        state: makeState(MODES.HOLDING, event.speed, 0, true, DEFAULT_REARM_BUDGET, false),
        effects: [
          effect(ARBITER_EFFECTS.WRITE, event.speed),
          effect(ARBITER_EFFECTS.PERSIST, event.speed),
          effect(ARBITER_EFFECTS.SYNC_UI, event.speed),
        ],
      };

    case ARBITER_EVENTS.TEMPORARY_OVERRIDE_START:
      if (state.mode === MODES.NO_OPINION || state.desired === null) {
        return { state, effects: [effect(ARBITER_EFFECTS.SYNC_UI, event.speed)] };
      }
      return {
        state: makeState(
          state.mode,
          state.desired,
          state.fightCount,
          state.warQuiet,
          state.rearmBudget,
          true
        ),
        effects: [effect(ARBITER_EFFECTS.SYNC_UI, event.speed)],
      };

    case ARBITER_EVENTS.TEMPORARY_OVERRIDE_END: {
      const next = makeState(
        state.mode,
        state.desired,
        state.fightCount,
        state.warQuiet,
        state.rearmBudget,
        false
      );
      if (next.mode === MODES.HOLDING && next.desired !== null) {
        const effects = [];
        if (event.speed !== next.desired) {
          effects.push(effect(ARBITER_EFFECTS.WRITE, next.desired));
        }
        effects.push(effect(ARBITER_EFFECTS.SYNC_UI, next.desired));
        return { state: next, effects };
      }
      return { state: next, effects: [effect(ARBITER_EFFECTS.SYNC_UI, event.speed)] };
    }

    case ARBITER_EVENTS.LIFECYCLE:
      if (state.temporaryOverride) {
        return { state, effects: [] };
      }
      if (state.mode === MODES.HOLDING) {
        return { state, effects: [effect(ARBITER_EFFECTS.WRITE, state.desired)] };
      }
      if (state.mode === MODES.REARMABLE) {
        return {
          state: makeState(MODES.HOLDING, state.desired, 0, true, state.rearmBudget, false),
          effects: [effect(ARBITER_EFFECTS.WRITE, state.desired)],
        };
      }
      return { state, effects: [] };

    case ARBITER_EVENTS.EXT_RATE: {
      const rate = event.speed;
      const activeState = state.temporaryOverride
        ? makeState(state.mode, state.desired, state.fightCount, state.warQuiet, state.rearmBudget, false)
        : state;

      switch (event.rateClass) {
        case RATE_CLASSES.INIT_NOISE:
          return { state: activeState, effects: [] };

        case RATE_CLASSES.USER_INTENT:
          return {
            state: makeState(MODES.HOLDING, rate, 0, true, DEFAULT_REARM_BUDGET, false),
            effects: [effect(ARBITER_EFFECTS.PERSIST, rate), effect(ARBITER_EFFECTS.SYNC_UI, rate)],
          };

        case RATE_CLASSES.AUTONOMOUS:
          if (activeState.mode === MODES.HOLDING && rate !== activeState.desired) {
            if (activeState.fightCount < maxFight) {
              const warQuiet =
                activeState.fightCount === 0 ? !!event.quiet : activeState.warQuiet && !!event.quiet;
              return {
                state: makeState(
                  MODES.HOLDING,
                  activeState.desired,
                  activeState.fightCount + 1,
                  warQuiet,
                  activeState.rearmBudget,
                  false
                ),
                effects: [effect(ARBITER_EFFECTS.WRITE, activeState.desired)],
              };
            }

            const fullyQuiet = activeState.warQuiet && !!event.quiet;
            const nextMode =
              fullyQuiet && activeState.rearmBudget > 0 ? MODES.REARMABLE : MODES.SUPPRESSED;
            const nextBudget =
              nextMode === MODES.REARMABLE ? activeState.rearmBudget - 1 : activeState.rearmBudget;
            return {
              state: makeState(nextMode, activeState.desired, 0, true, nextBudget, false),
              effects: [effect(ARBITER_EFFECTS.SYNC_UI, rate)],
            };
          }
          return { state: activeState, effects: [effect(ARBITER_EFFECTS.SYNC_UI, rate)] };

        default:
          throw new TypeError(`SpeedArbiter: unknown rate class ${event.rateClass}`);
      }
    }

    case ARBITER_EVENTS.FIGHT_WINDOW_EXPIRE:
      if (state.fightCount === 0) {
        return { state, effects: [] };
      }
      return {
        state: makeState(
          state.mode,
          state.desired,
          0,
          true,
          state.rearmBudget,
          state.temporaryOverride
        ),
        effects: [],
      };

    default:
      throw new TypeError(`SpeedArbiter: unknown event type ${event.type}`);
  }
}

export const SpeedArbiter = Object.freeze({
  MODES,
  EVENTS: ARBITER_EVENTS,
  RATE_CLASSES,
  EFFECTS: ARBITER_EFFECTS,
  DEFAULT_MAX_FIGHT,
  DEFAULT_REARM_BUDGET,
  loadState,
  makeState,
  step,
});


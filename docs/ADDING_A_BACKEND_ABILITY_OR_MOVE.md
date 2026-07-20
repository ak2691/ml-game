# Adding an Authoritative Backend Ability or Move

The Spring simulator decides rated `duel-v1` results. Its behavior must match the browser runtime, but it must independently validate and execute the submitted structured brain.

Start with the gameplay contract in [Adding an Ability or Move](ADDING_AN_ABILITY_OR_MOVE.md) and [Ability Effect Contract](ABILITY_EFFECT_CONTRACT.md).

## 1. Mirror definitions and loadout identity

Use object definitions, not scattered one-off constants:

- `server/src/main/java/com/example/machiner/simulation/combat/Abilities.java` owns authoritative ability definitions.
- `server/src/main/java/com/example/machiner/simulation/combat/Moves.java` owns authoritative move definitions.
- `server/src/main/java/com/example/machiner/simulation/combat/CombatRules.java` exposes shared `duel-v1` values to the simulator.
- `server/src/main/java/com/example/machiner/simulation/combat/CombatCatalog.java` selects the ruleset and contains only boundary compatibility for old replay classes.
- `server/src/main/java/com/example/machiner/simulation/combat/AbilityContracts.java` declares delivery, ordered effect classifications, and shield policy for every move/ability.

Match the browser's milliseconds, arena units, damage rounding, falloff anchors, ranges, arcs, and resource counts exactly.

The loadout also has an encoded compact ID. Update the server-side loadout code mapping in `MatchmakingService` when adding the frontend code in `BotLoadout.js`. Verify round pool, cumulative loadout, maximum selection count, and stat budget behavior.

Match ability drafting is cumulative and server-authoritative. The server deterministically shuffles that round's complete ability pool using the match seed and round number, and both players receive the same offer list. Round 1 offers 6 and requires 3 picks; Round 2 offers 4 and requires 2 picks; Round 3 offers 3 and requires 1 pick. Prior picks cannot be removed, so a completed Round 3 loadout contains 6 abilities. The server must reject picks outside the issued `abilityOffers` list. On timeout, it randomly fills every required slot from that same shuffled offer list.

## 2. Update boundary validation

`server/src/main/java/com/example/machiner/service/ModelSubmissionValidationService.java` is the hostile-input boundary. Update its explicit allowlists where applicable:

- `ALLOWED_ABILITIES`;
- `PROTOTYPE_ACTIONS` or the appropriate action set;
- `PREPARING_ABILITIES` only when preparation time is greater than zero;
- condition variables and target validation for a new generic contract;
- action-to-loadout ownership checks.

Prefer capability-derived generic targets and selected-ability conditions in new code. Preserve a retired condition/action ID only in an explicit normalizer or migration.

Validation must reject:

- an action not owned by the submitted loadout;
- an invalid ability selection inside a selected-ability condition;
- an entity target that the observed loadout cannot produce;
- malformed or out-of-range offsets, coordinates, thresholds, identifiers, and payload sizes;
- a preparing query for an ability with no wind-up.

Do not trust the client's selected action, collision result, damage, target identity, or claimed outcome.

## 3. Add authoritative action behavior

`server/src/main/java/com/example/machiner/simulation/DuelSimulationService.java` currently owns the deterministic tick, tree evaluation, action-head selection, direct combat, short-lived grenade/fireball processing, statuses, and replay frame construction.

For a new feature, keep these concerns separate inside the flow:

1. Read a normalized action from the submitted tree.
2. Resolve the live target and offsets.
3. Check ownership, readiness, preparation, resources, silence/null-zone rules, and target existence.
4. Activate the action and record cooldown/resource/preparation state.
5. Apply an immediate effect or create an entity.
6. Tick existing effects/entities in deterministic order.
7. settle accumulated damage/healing and emit replay state.

Do not special-case a new ability in condition evaluation if an existing generic selected-ability or entity-target variable already represents it.

The service is still a migration boundary for direct attacks and short-lived projectiles. New persistent entity behavior belongs in the ECS files below. When extracting more service logic, use small pure systems and leave `DuelSimulationService` as the orchestrator; do not introduce a second competing simulation loop.

## 4. Persistent entities and ECS

Use the ECS path for a targetable or persistent zone, trap, summon, or warning marker.

### `ArenaEntity.java`

This is the authoritative entity state. Its component view separates:

- transform;
- motion and traveled distance;
- lifetime/timer;
- collider/size;
- ownership;
- optional health;
- ability-specific state such as armed/type.

Flat record accessors remain for inexpensive replay mapping during the migration. Add a component only when a reusable system needs a new concern; do not add fighter UI state here.

### `AbilityEntityFactory.java`

Add a factory method that creates deterministic initial state: ID, owner slot, position, velocity, size, lifetime, health, and initial phase. It must not find targets, deal damage, or advance time.

### `AbilityEntityCombatant.java`

This is the minimal fighter interface used by the entity system. Extend it only if an entity system needs a reusable fighter capability that cannot be expressed through the combat callback. Avoid coupling the ECS to the simulator's private `Fighter` implementation.

### `AbilityEntitySystem.java`

Add lifecycle and interaction behavior here. Its generic `Combat<F>` adapter supplies damage and geometry callbacks while keeping the system testable with small fake combatants.

The system should return the next entity list. Removal, phase changes, spawned explosions, damage, status application, and chain reactions must be deterministic. Ownership rules must be explicit.

### `ArenaBounds.java`

Use the shared bounds value for clamping and expiry. Do not copy arena dimensions into ability code.

## 5. Collision and status rules

Resolve `shieldInteraction` once per impact and apply the remaining effect classes in their declared order. Entity systems pass the ability ID to the shared shield resolver; they must not carry their own arc, charge-drain, or prevented-status constants.

Any damage source—melee, hitscan, projectile, beam, or area—must damage every intersected arena entity declared damageable and carrying HP. Fighter-only effects such as stun or bleed eligibility must not be applied to arbitrary entities.

For each effect define:

- whether blocking or armor applies;
- whether friendly entities/fighters are eligible;
- swept versus point-in-time collision;
- whether damage occurs on impact, explosion start, or a traveling front;
- chain-reaction behavior;
- refresh, stack, or replace semantics for timed status;
- rounding and order when damage and healing occur in one tick.

Accumulate same-tick changes and settle a net HP result. For example, healing 15 and taking 8 produces `+7`, subject to the final max-HP clamp. Presentation order must not change that result.

## 6. Replay and service integration

`server/src/main/java/com/example/machiner/service/MatchSimulationService.java` invokes the authoritative duel and persists/releases its result. `DuelSimulationService` maps fighters and entities into `MatchPlaybackDTO` frames.

Expose enough state for the browser to reconstruct gameplay presentation:

- stable entity ID/type and owner slot;
- position, rotation/velocity when needed, size, phase, lifetime/timer, and HP;
- fighter preparing ability and elapsed time;
- active/cooldown/resource/status fields used by arena UI;
- explosion/cast/ray start and remaining time when the visual is time-based.

Replay data describes state; it must not ask the client to rerun authoritative collision or damage.

## 7. Backend tests

Add focused tests before relying on the full suite:

- `ModelSubmissionValidationService` tests for allowlist, loadout ownership, target IDs, offsets, and preparation rules;
- `DuelSimulationServiceTest` for an `ALWAYS` action reaching actual activation and producing damage/state;
- both fighter slots where action symmetry matters;
- readiness, resource, cooldown, and preparation transitions;
- missing-target priority fallthrough;
- deterministic collision and same-tick settlement;
- timeout/KO behavior and replay metadata;
- `simulation/ecs/AbilityEntitySystemTest` for factory components, lifetime, interaction, HP, all applicable attack types, removal, and chain reactions.

Run the authoritative suite from `server`:

```powershell
.\mvnw.cmd test
```

## Backend completion check

An ability is not authoritative merely because its ID validates. A submitted `ALWAYS` action must pass validation, be selected, activate, execute its actual effect, appear correctly in replay state, and produce the same deterministic result on repeated runs.

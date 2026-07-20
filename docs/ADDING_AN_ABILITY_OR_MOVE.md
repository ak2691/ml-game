# Adding an Ability or Move

This is the end-to-end checklist for adding gameplay to `duel-v1`. The browser is the fast training and presentation runtime; the Spring simulator is the authority for match results. A change is complete only when both runtimes implement the same contract.

For the reusable gameplay schema, read [Ability Effect Contract](ABILITY_EFFECT_CONTRACT.md). For detailed server work, read [Adding a Backend Ability or Move](ADDING_A_BACKEND_ABILITY_OR_MOVE.md).

## 1. Define the contract first

Add the delivery, ordered effects, and `shieldInteraction` entry to `frontend/src/beta/combat/AbilityContracts.js`. Do not encode shield behavior as an ability-name branch in a delivery system. Damage, healing, knockback, pull, debuffs, interruption, movement/state changes, and entity spawning are independent composable effects.

Write down the behavior before editing code:

- stable ability ID and player-facing label;
- `ability` or `move`, and its round pool;
- cooldown, wind-up/preparation, active time, charges, recharge, damage, range, size, speed, and lifetime;
- targeting mode: direction, coordinates, fighter, or live entity plus signed X/Y offsets;
- whether it creates a projectile, ray, zone, trap, summon, warning marker, or no world entity;
- entity capabilities such as `entity`, `projectile`, `ray`, `zone`, `wind-up`, `hittable`, `destructible`, and `chainable`;
- collision targets and ownership rules;
- fighter-only statuses such as burn, bleed, slow, stun, silence, armor, or healing;
- visual timing, `visualInterpolation`, and replay data;
- exact browser/server tick timing and rounding.

Do not use a capability merely to make a UI control appear. Tags are gameplay contracts consumed by targeting, conditions, collision, and validation.

## 2. Add the browser definition

### Catalog and loadout metadata

Edit `frontend/src/beta/loadout/BotLoadout.js`:

1. Add the catalog entry with `id`, `label`, `round`, `kind`, `visualInterpolation`, `actions`, and `summary`.
2. If it creates an independently targetable entity, add its `entityType`, `entityLabel`, and capability tags to `ENTITY_CAPABILITIES`.
3. Add a compact code to `ABILITY_CODES` because match loadouts are serialized as `custom:<codes>:<stats>`.

`BOT_ABILITIES` is consumed by the draft UI, Bot Room loadout UI, action menus, selected-ability condition controls, and generated entity targets. Do not add separate handwritten UI lists for one ability.

### Numeric gameplay definition

Add one object entry to the appropriate file:

- `frontend/src/beta/combat/Abilities.js` for an ability;
- `frontend/src/beta/combat/Moves.js` for a move.

Keep the complete definition in the object. Existing exported scalar constants are compatibility aliases for older callers, not the pattern for new gameplay.

### Logic schema and selection

Most new actions are derived automatically from `BOT_ABILITIES`. Verify these consumers rather than adding duplicate definitions:

- `frontend/src/logic/BotBrain.js` normalizes the tree, builds condition/action definitions, evaluates visible priority, resolves targets, and selects independent action heads.
- `frontend/src/beta/StrategyTrainingPanel.jsx` filters actions and selected-ability controls by equipped loadout and tags.
- `frontend/src/beta/modelPayloads/strategyStatePayload.js` exposes current fighter/entity state to the brain.

Only edit `BotBrain.js` when the new feature introduces a genuinely new condition variable, action payload shape, target mode, or action head. Keep old IDs only in explicit normalization/migration code. `ALWAYS` must remain valid and visible.

A target-dependent action must be ineligible when its live target does not exist. It must fall through without consuming priority.

## 3. Connect selection to execution

The browser pipeline is:

```text
state snapshot -> BotBrain selection -> action payload -> executor -> combat/entity systems -> next state
```

Use the smallest applicable layer:

| Behavior | File to change | Responsibility |
| --- | --- | --- |
| New action payload or execution head | `frontend/src/logic/ArenaActionPlanner.js` | Converts the selected logic plan into `{ dx, dy, dRot, dashAction, abilityAction }`. Every combat move/ability uses the same `abilityAction` object. No damage or collision math. |
| Cooldown, charge, wind-up, cast activation, or spawn request | `frontend/src/beta/ecs/ActionExecutionSystem.js` | Mutates one fighter's action state for the tick and emits spawn requests. |
| Direct melee, hitscan, block, healing, or fighter-to-fighter result | `frontend/src/beta/combat/FighterCombatSystem.js` | Resolves immediate combat and accumulates damage/healing. |
| Grenade/fireball-style short-lived projectile | `frontend/src/beta/ecs/ProjectileSystem.js` | Creates, moves, collides, expires, and removes projectiles. |
| Persistent zone, trap, marker, or summon | `frontend/src/beta/ecs/EntityFactory.js` and `AbilityEntitySystem.js` | Factory defines initial components; system owns lifetime and interactions. |
| Generic component movement/lifetime | `frontend/src/beta/ecs/EntityWorld.js` | Reusable ordered systems, independent of ability names. |
| Timed fighter effect | `frontend/src/beta/ecs/FighterStatusSystem.js` | Advances statuses, cooldown-like timers, DOT, and resource timers. |

`frontend/src/beta/BetaModel.jsx` should only orchestrate those functions and commit their returned state. Do not put ability-specific geometry, damage formulas, cooldown rules, or entity lifecycle code back into the page.

### Choosing an entity path

- No independent world object: use fighter action/combat/status systems.
- Fast, short-lived projectile matching the existing grenade/fireball lifecycle: use `ProjectileSystem.js`.
- Persistent, targetable, destructible, armed, summoned, or multi-stage object: use `EntityFactory.js` plus `AbilityEntitySystem.js`.
- Reusable movement/lifetime behavior: compose a generic `EntityWorld.js` system instead of copying a tick loop.

An entity factory only creates initial state. It must not apply collision or damage. A system calculates changes while the entity exists.

## 4. Add presentation without changing gameplay

- `frontend/src/beta/combat/FighterVisual.jsx` renders the fighter, anchored HP/status UI, and fighter-owned cast/attack animations.
- `frontend/src/beta/combat/ArenaEntityVisual.jsx` renders projectiles, fields, drones, mines, markers, and explosions.
- `frontend/src/beta/combat/visualState.js` contains pure presentation calculations such as ray opacity.
- `frontend/src/beta/ShapeObject.jsx` positions an arena object and chooses the fighter or entity visual.

Keep HP bars and status icons outside the rotating fighter body. Timed buffs, armor, guard, burn, and bleed use compact icons above the HP bar. Weapon/cast visuals appear only while active; they do not permanently replace the bot model.

Visuals may derive opacity, scale, or animation progress from state, but must never apply damage, change cooldowns, or decide hits. Every arena surface must use the same visual/state contract: Bot Room, match setup/training, and replay.

### Visual interpolation contract

Every catalog entry explicitly declares `visualInterpolation` so new visuals do not inherit an accidental animation style:

- `none` is for instantaneous/hitscan gameplay: melee attacks, rays, beams, and other effects whose combat result exists on one simulation tick. Their cosmetic timer may show a short discrete sweep or fade for readability, but it must not move the authoritative origin, endpoint, or hit geometry between ticks.
- `linear` is for physical positional motion: fighters, dashes, projectiles, thrown objects, moving waves, and summons. Interpolation only smooths authoritative positions received from the simulation; it never changes collision or timing.

`ShapeObject.jsx` consumes this label for ability-owned arena entities. Fighter-owned instantaneous effects use the same catalog contract and must not add CSS position/sweep interpolation. If an ability has both an instantaneous impact and a moving entity, model those as separate visual phases and apply the appropriate category to each phase.

Attack speed follows the same timing rule in both runtimes: multiply the cooldown/reload duration once when the action activates, then subtract actual elapsed milliseconds. Never speed up the clock by subtracting attack-speed-scaled elapsed time.

Sword Swing and Heavy Slash use four evenly spaced cosmetic poses from negative to positive angles around the fighter's forward line. Their damage still resolves instantly on the activation tick. Both use a 92-unit weapon range. Heavy Slash is shield-blockable, consumes every remaining shield charge when blocked, and each missing shield charge recharges in five seconds.

### Shield resolution contract

The rules below are represented by `shieldInteraction` metadata. A handler resolves that policy once and filters effect classes; it does not separately decide damage and attached status behavior.

- Shield may be held continuously. Releasing it starts a separate two-second activation cooldown; this never changes charge count or charge-reload progress.
- Each missing charge independently advances on the shared five-second recharge accumulator. Replay/UI payloads expose `blockCooldownMs` and `blockRechargeMs` separately.
- A successful block prevents both damage and every status attached to that hit, including Fireball burn, Concussive slow, Rail Shot shock, and Silence Pulse silence/stun.
- Proximity Mine and Gravity Grenade damage require the shield to face the effect center within ±45 degrees and drain all remaining charges. Gravity pull is not blockable.
- Hunter Drone shots use normal directional blocking. Repulsor Burst deals 20 damage and pushes 250 units; a normal directional block prevents its damage but not its displacement. Thrust deals 15 damage and applies 30-unit displacement; both remain unblockable.
- Orbital Strike damage is unblockable, but an active shield in its blast loses all remaining charges.

## 5. Mirror the authoritative server

Follow [Adding a Backend Ability or Move](ADDING_A_BACKEND_ABILITY_OR_MOVE.md). At minimum, mirror:

- definition values and units;
- loadout ID/code and validation;
- condition/action eligibility and target resolution;
- preparation, cooldown, and resources;
- geometry, collision targets, damage, statuses, and lifetime;
- persistent entity factory/system behavior;
- replay metadata needed by the shared visuals.

Never treat successful browser behavior as proof that a rated match supports the feature.

## 6. Tests required for completion

Add the narrowest tests at each changed boundary.

### Browser

- catalog/tag and generated action/target tests;
- normalization and condition eligibility tests in `BotBrain.test.js`;
- an `ALWAYS` brain that reaches the real executor and produces gameplay state/effect;
- slot 1 and slot 2 Bot Room execution where the action is available to both bots;
- missing-target priority fallthrough for target-dependent actions;
- factory component and system lifecycle/collision tests in `EntitySystems.test.js`;
- status timing and simultaneous damage/healing net-result tests when applicable;
- visual-state tests for time-based presentation such as fading rays.

A picker or action-plan test alone is not enough: the action must reach its real executor.

### Server

- submission allowlist/loadout/target validation;
- authoritative `ALWAYS` execution;
- deterministic geometry, damage, cooldown, preparation, status, and expiry;
- entity target selection and missing-target fallthrough;
- object HP and all applicable damage sources for a destructible entity;
- replay frame state and deterministic repeatability.

Run:

```powershell
cd frontend
npm test
npm run lint
npm run build

cd ..\server
.\mvnw.cmd test
```

## Definition of done

The change is complete when the catalog, tree UI, normalization, submission, server validation, browser execution, authoritative execution, entity targeting, visuals, replay, and tests all agree. If an old submission ID is replaced, add an explicit boundary migration; do not keep the legacy ID in new-condition menus.

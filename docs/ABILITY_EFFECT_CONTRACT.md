# Ability Effect Contract

Abilities and moves are assembled from declarative gameplay metadata. Runtime handlers deliver and execute that metadata; renderers only present it.

## Contract shape

Every selectable ability has one contract with three independent parts:

```text
delivery          how effects reach a target
effects[]         composable game-state changes
shieldInteraction which effect classes a shield prevents and its resource cost
```

The browser catalog is `frontend/src/beta/combat/AbilityContracts.js`. The authoritative mirror is `server/src/main/java/com/example/machiner/simulation/combat/AbilityContracts.java`. Browser contracts reference numeric tuning from `Abilities` and `Moves`; the authoritative catalog carries the mirrored effect magnitudes. Values calculated from distance, combo state, or another runtime input are explicitly marked `runtimeComputed` on the server.

## Delivery classifications

Current delivery types are `self`, `melee`, `ray`, `projectile`, `radial`, `field`, `trap`, `summon`, and `teleport`. Delivery owns travel/collision/target timing. It does not imply damage or a visual interpolation style.

Entity spawning is an effect (`spawn_entity`) whose entity type is declared in the contract. Targeting capabilities and player-facing entity labels remain in `BotLoadout.js` because they are UI/schema metadata.

## Effect classifications

- `damage` and `healing` change HP.
- `knockback` moves away from a source; `pull` moves toward it.
- `debuff` carries a subtype such as burn, bleed, slow, stun, silence, or shock.
- `interrupt` cancels preparation when the game rule permits it.
- `movement` and `teleport` relocate the acting fighter.
- `restore_state` restores a prior snapshot.
- `damage_reduction`, `damage_immunity`, and `damage_reflection` modify incoming damage handling.
- `spawn_entity` creates a projectile, zone, trap, summon, marker, or other arena entity.

Effects are composable. An ability that pulls, then knocks back, then damages declares those three effects in deterministic execution order and supplies their magnitudes. Add a new effect type only when its game-state behavior is reusable and materially different from existing types.

Some stateful effects still need a reusable executor (for example, restoring a temporal snapshot). That executor switches on the effect class or subtype, not on the ability ID. Ability-ID branches are reserved for genuinely unique mechanics during migration and should not define shield behavior.

## Shield interaction

`shieldInteraction` declares:

- mode: `block`, `ignore`, or `drain_while_active`;
- directional half-arc for `block`;
- charge cost: one, all, or distance-scaled;
- the effect classes prevented by a successful block.

This supports partial interactions without special-case handlers. Repulsor Burst prevents `damage` but retains `knockback`; Gravity Grenade prevents `damage` but retains `pull`; Orbital Strike prevents nothing but drains an active shield.

A delivery system resolves the shield once per impact, filters the declared effect list, and applies every remaining effect in order. It must not independently decide that an attached debuff lands after its damage was blocked.

## Presentation boundary

Animation, color, shape, ray fading, and interpolation live in the visual files. They may read delivery/effect metadata, but never determine hits or modify game state. Replay and training consume the same contract and visual components; the Java simulation remains authoritative for rated outcomes.

## Adding an ability

1. Add its numeric definition to `Abilities` or `Moves` in both runtimes.
2. Add its delivery, ordered effects, and shield policy to both contract catalogs.
3. Add loadout/entity targeting metadata when it spawns a targetable object.
4. Connect a generic delivery and effect executor; avoid a new ability-ID branch where an existing classification works.
5. Add the unique visual separately.
6. Add table-driven parity tests for effect and shield metadata plus an execution test.

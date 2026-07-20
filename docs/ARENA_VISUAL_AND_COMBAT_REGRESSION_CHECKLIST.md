# Arena visual and combat regression checklist

This file records recurring implementation mistakes that have caused the same arena regressions more than once. Use it whenever an ability, move, entity, replay field, or fighter visual changes.

## Transform ownership

- Never put `transition-all` on a fighter whose rotation is normalized to `0..359`. A `359 -> 0` state update can be interpolated as the long rotation. Fighter rotation is presented immediately unless a dedicated shortest-angle renderer owns interpolation.
- Phase Strike and teleports must not reuse normal movement/rotation interpolation. Their destination and facing are discrete gameplay state changes.
- Never apply a CSS animation such as Tailwind `animate-ping` to the same element whose inline `transform` centers it. The animation owns `transform` and discards `translate(-50%, -50%)`, which makes Repulsor Burst and Repair Pulse look as though they are dropped onto the bot.
- For centered pulses, keep the center translation in every animation frame or use a stationary positioning wrapper and animate only its child. The pulse begins near scale zero at the caster's center and expands outward.

## Timer-driven weapon visuals

- Rays must derive opacity from their remaining visual timer. Fire Gun and Pistol Shot must visibly fade instead of disappearing at full opacity.
- Sword Swing and Heavy Slash must derive their angle from elapsed active time. Render the sword bar on the first active frame, sweep it across the bot, and remove it only after the active timer ends.
- Separate a short activation visual from the gameplay-effect duration. Reactive Armor can remain active in combat and in its status icon after its initial glow has faded.
- Temporal Rewind preserves its activation coordinates independently of the fighter. Show the initial clock, show reverse-spinning hands during the final second, and emit the completion pulse at the saved coordinates when the teleport occurs.

## Combat state accumulation

- Every source on a simulation tick operates on the latest fighter state. Never rebuild a fighter from a stale pre-hit snapshot.
- Burn, bleed, shock, melee, rays, projectiles, explosions, reflected damage, and healing must compose into one net HP result. Regression coverage must include multiple DOT ticks plus direct damage and healing on the same tick.
- Numeric HP belongs in the side status panel. The arena fighter shows only a compact health bar whose fill width is calculated from the current `hp / maxHp`.

## Status-effect ownership

- Silence Pulse owns a timed silence duration after impact.
- Null Zone owns a presence flag, not a refreshed timed silence. Set it while the fighter intersects an active zone and clear it in the first world update after the fighter leaves every zone.
- Gameplay duration and activation glow are different state. Status icons reflect gameplay duration; cast visuals reflect presentation timers.

## Surface parity

Verify each change in all three arena surfaces:

1. Bot Room autoplay for both bot slots.
2. Match setup/training arena.
3. Authoritative replay frames.

For every changed action, test an `ALWAYS` brain through the real executor. A schema/picker test alone does not verify gameplay or presentation.

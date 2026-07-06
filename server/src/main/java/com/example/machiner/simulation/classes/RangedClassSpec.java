package com.example.machiner.simulation.classes;

import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class RangedClassSpec implements CombatClassSpec {

    private static final int GUN_AMMO_MAX = 10;
    private static final int GUN_RELOAD_MS = 3_000;
    private static final int GUN_COOLDOWN_MS = (int) Math.round(60_000.0 / 60.0);
    private static final int GRENADE_COOLDOWN_MS = 12_000;
    private static final double GRENADE_EXPLOSION_RADIUS = 50.0;
    private static final List<DamageAnchor> DAMAGE_FALLOFF = List.of(
            new DamageAnchor(100.0, 15),
            new DamageAnchor(300.0, 10),
            new DamageAnchor(500.0, 5),
            new DamageAnchor(700.0, 2));

    @Override
    public String id() {
        return "ranged";
    }

    @Override
    public int maxHp() {
        return 100;
    }

    @Override
    public boolean canFireGun() {
        return true;
    }

    @Override
    public boolean canThrowGrenade() {
        return true;
    }

    @Override
    public int gunCooldownMs() {
        return GUN_COOLDOWN_MS;
    }

    @Override
    public int gunActiveMs() {
        return GUN_COOLDOWN_MS;
    }

    @Override
    public int gunAmmoMax() {
        return GUN_AMMO_MAX;
    }

    @Override
    public int gunReloadMs() {
        return GUN_RELOAD_MS;
    }

    @Override
    public double gunRange() {
        return DAMAGE_FALLOFF.get(DAMAGE_FALLOFF.size() - 1).distance();
    }

    @Override
    public int gunDamage(double distance) {
        if (distance <= DAMAGE_FALLOFF.getFirst().distance()) {
            return DAMAGE_FALLOFF.getFirst().damage();
        }
        for (int index = 1; index < DAMAGE_FALLOFF.size(); index += 1) {
            DamageAnchor near = DAMAGE_FALLOFF.get(index - 1);
            DamageAnchor far = DAMAGE_FALLOFF.get(index);
            if (distance <= far.distance()) {
                return (int) Math.round(interpolateDamage(distance, near, far));
            }
        }
        return 0;
    }

    @Override
    public int grenadeCooldownMs() {
        return GRENADE_COOLDOWN_MS;
    }

    @Override
    public int grenadeDamage(double nearestBodyDistance) {
        if (nearestBodyDistance > GRENADE_EXPLOSION_RADIUS) {
            return 0;
        }
        double t = Math.max(0.0, Math.min(1.0, nearestBodyDistance / GRENADE_EXPLOSION_RADIUS));
        double rawDamage = 50.0 + (25.0 - 50.0) * t;
        return (int) Math.max(25, Math.min(50, Math.round(rawDamage / 5.0) * 5));
    }

    private static double interpolateDamage(double distance, DamageAnchor near, DamageAnchor far) {
        double t = Math.max(0.0, Math.min(1.0, (distance - near.distance()) / (far.distance() - near.distance())));
        return near.damage() + (far.damage() - near.damage()) * t;
    }

    private record DamageAnchor(double distance, int damage) {
    }
}

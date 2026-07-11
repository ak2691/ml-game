package com.example.machiner.simulation.classes;

import org.springframework.stereotype.Component;

@Component
public class MageClassSpec implements CombatClassSpec {

    private static final int FIREBALL_CHARGES_MAX = 4;
    private static final int FIREBALL_RELOAD_MS = 1_000;
    private static final int FIREBALL_COOLDOWN_MS = (int) Math.round(60_000.0 / 90.0);
    private static final int FIREBALL_DAMAGE = 15;
    private static final int FIREBALL_BURN_DAMAGE = 2;
    private static final int FIREBALL_BURN_DURATION_MS = 5_000;
    private static final int FIREBALL_BURN_TICK_MS = 1_000;
    private static final int STUN_DURATION_MS = 1_500;

    @Override
    public String id() {
        return "mage";
    }

    @Override
    public int maxHp() {
        return 100;
    }

    @Override
    public double moveSpeed() {
        return 10.0;
    }

    @Override
    public boolean canShootFireball() {
        return true;
    }

    @Override
    public boolean canStun() {
        return true;
    }

    @Override
    public int fireballCooldownMs() {
        return FIREBALL_COOLDOWN_MS;
    }

    @Override
    public int fireballActiveMs() {
        return FIREBALL_COOLDOWN_MS;
    }

    @Override
    public int fireballChargesMax() {
        return FIREBALL_CHARGES_MAX;
    }

    @Override
    public int fireballReloadMs() {
        return FIREBALL_RELOAD_MS;
    }

    @Override
    public double fireballRange() {
        return 400.0;
    }

    @Override
    public int fireballDamage() {
        return FIREBALL_DAMAGE;
    }

    @Override
    public int fireballBurnDamage() {
        return FIREBALL_BURN_DAMAGE;
    }

    @Override
    public int fireballBurnDurationMs() {
        return FIREBALL_BURN_DURATION_MS;
    }

    @Override
    public int fireballBurnTickMs() {
        return FIREBALL_BURN_TICK_MS;
    }

    @Override
    public int stunCooldownMs() {
        return 10_000;
    }

    @Override
    public int stunActiveMs() {
        return 200;
    }

    @Override
    public int stunDamage() {
        return 10;
    }

    @Override
    public int stunDurationMs() {
        return STUN_DURATION_MS;
    }

    @Override
    public double stunRange() {
        return 184.0;
    }

    @Override
    public double stunArcDegrees() {
        return 100.0;
    }
}

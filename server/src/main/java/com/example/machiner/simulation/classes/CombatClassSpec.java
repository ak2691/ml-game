package com.example.machiner.simulation.classes;

public interface CombatClassSpec {

    String id();

    int maxHp();

    default double moveSpeed() {
        return 8.0;
    }

    default boolean canSwing() {
        return false;
    }

    default boolean canBlock() {
        return false;
    }

    default int blockMaxCharges() {
        return 0;
    }

    default int blockRechargeMs() {
        return 0;
    }

    default boolean canDash() {
        return false;
    }

    default int dashMaxCharges() {
        return 0;
    }

    default int dashRechargeMs() {
        return 0;
    }

    default boolean canFireGun() {
        return false;
    }

    default boolean canThrowGrenade() {
        return false;
    }

    default boolean canShootFireball() {
        return false;
    }

    default boolean canStun() {
        return false;
    }

    default double attackRange() {
        return 0.0;
    }

    default double attackArcDegrees() {
        return 0.0;
    }

    default int attackDamage() {
        return 0;
    }

    default int gunCooldownMs() {
        return 0;
    }

    default int gunActiveMs() {
        return 0;
    }

    default int gunAmmoMax() {
        return 0;
    }

    default int gunReloadMs() {
        return 0;
    }

    default double gunRange() {
        return 0.0;
    }

    default int gunDamage(double distance) {
        return 0;
    }

    default int grenadeCooldownMs() {
        return 0;
    }

    default int grenadeDamage(double nearestBodyDistance) {
        return 0;
    }

    default int fireballCooldownMs() {
        return 0;
    }

    default int fireballActiveMs() {
        return 0;
    }

    default int fireballChargesMax() {
        return 0;
    }

    default int fireballReloadMs() {
        return 0;
    }

    default double fireballRange() {
        return 0.0;
    }

    default int fireballDamage() {
        return 0;
    }

    default int fireballBurnDamage() {
        return 0;
    }

    default int fireballBurnDurationMs() {
        return 0;
    }

    default int fireballBurnTickMs() {
        return 0;
    }

    default int stunCooldownMs() {
        return 0;
    }

    default int stunActiveMs() {
        return 0;
    }

    default int stunDamage() {
        return 0;
    }

    default int stunDurationMs() {
        return 0;
    }

    default double stunRange() {
        return 0.0;
    }

    default double stunArcDegrees() {
        return 0.0;
    }
}

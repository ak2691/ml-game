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

    default boolean canFireGun() {
        return false;
    }

    default boolean canThrowGrenade() {
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
}

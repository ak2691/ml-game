package com.example.machiner.simulation.classes;

import org.springframework.stereotype.Component;

@Component
public class MeleeClassSpec implements CombatClassSpec {

    @Override
    public String id() {
        return "melee";
    }

    @Override
    public int maxHp() {
        return 125;
    }

    @Override
    public double moveSpeed() {
        return 12.0;
    }

    @Override
    public boolean canSwing() {
        return true;
    }

    @Override
    public boolean canBlock() {
        return true;
    }

    @Override
    public int blockMaxCharges() {
        return 5;
    }

    @Override
    public int blockRechargeMs() {
        return 3000;
    }

    @Override
    public boolean canDash() {
        return true;
    }

    @Override
    public int dashMaxCharges() {
        return 2;
    }

    @Override
    public int dashRechargeMs() {
        return 4500;
    }

    @Override
    public double attackRange() {
        return 92.0;
    }

    @Override
    public double attackArcDegrees() {
        return 50.0;
    }

    @Override
    public int attackDamage() {
        return 20;
    }
}

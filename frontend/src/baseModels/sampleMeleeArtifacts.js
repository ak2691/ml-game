export const sampleManifest = {
    rulesetVersion: "melee-v0",
    featureSchemaVersion: "melee-v0-observation-1",
    actionSchemaVersion: "melee-v0-discrete-1",
    latestRunId: "sample-run",
    generatedAt: "sample",
    actionNames: [
        "idle",
        "move_forward",
        "move_back",
        "strafe_left",
        "strafe_right",
        "turn_left",
        "turn_right",
        "attack",
    ],
    checkpoints: [
        {
            id: "sample-checkpoint",
            episode: 0,
            replayPath: "sample",
            metrics: {
                averageReturn: 0,
                winRate: 0,
                hitCount: 0,
                blockedMovementCount: 0,
            },
        },
    ],
};

export const sampleReplay = {
    rulesetVersion: "melee-v0",
    seed: 0,
    arenaSize: 800,
    actionNames: sampleManifest.actionNames,
    summary: {
        totalReward: 0,
        playerHp: 100,
        enemyHp: 100,
        frames: 80,
    },
    frames: Array.from({ length: 80 }, (_, index) => {
        const t = index / 79;
        const playerX = 150 + t * 260;
        const playerY = 420 - Math.sin(t * Math.PI) * 80;
        const enemyX = 640 - t * 95;
        const enemyY = 380 + Math.cos(t * Math.PI) * 40;
        return {
            tick: index,
            action: index % 18 === 0 ? "attack" : index % 5 === 0 ? "turn_right" : "move_forward",
            reward: index % 18 === 0 ? 0.2 : 0.01,
            combatEvents: index % 18 === 0 ? [{ type: "sample_hit_window", value: 0.2 }] : [],
            player: {
                x: playerX,
                y: playerY,
                facing: Math.atan2(enemyY - playerY, enemyX - playerX),
                hp: 100,
                attackCooldown: index % 18 === 0 ? 10 : 0,
                attackActive: index % 18 === 0 ? 2 : 0,
            },
            enemy: {
                x: enemyX,
                y: enemyY,
                facing: Math.atan2(playerY - enemyY, playerX - enemyX),
                hp: Math.max(40, 100 - Math.floor(index / 18) * 20),
                attackCooldown: 0,
                attackActive: 0,
            },
            obstacles: [
                { x: 360, y: 265, width: 80, height: 180 },
                { x: 475, y: 520, width: 120, height: 64 },
            ],
            sensors: {},
            actionScores: {
                idle: -0.1,
                move_forward: 0.4 + t,
                attack: t > 0.55 ? 1.2 : 0.1,
                turn_right: 0.2,
            },
        };
    }),
};

import { encodeSandboxLoadout } from "../beta/loadout/BotLoadout.js";
import { MAIN_SHAPE, buildOpponentShape, resetFighterShape } from "../beta/modelPayloads/arenaShapes.js";

function loadout(...abilities) {
    return encodeSandboxLoadout({ abilities, statPoints: { maxHp: 0, moveSpeed: 0, attackDamage: 0, attackSpeed: 0 } });
}

function branch(id, conditions, actions, branchType = "if", createdOrder = 0) {
    return { id, branchType, createdOrder, priority: 1, conditions, actions, children: [] };
}

function column(id, name, createdOrder, branches) {
    return { id, name, createdOrder, branches };
}

const always = () => ({ type: "always" });
const compare = (left, comparator, value, leftTarget = undefined) => ({
    type: "expression", left, comparator, right: { type: "number", value }, ...(leftTarget ? { leftTarget } : {}),
});
const move = (direction, target = "opponent") => ({ action: "move_walk", movementMode: "target", movementDirection: direction, actionTarget: target });
const face = (target = "opponent") => ({ action: "rotate_toward_enemy", actionTarget: target });

export function createEmptyTutorialBrain() {
    return { version: "melee-logic-tree-v1", columns: [], blocks: [], clusters: [], customVariables: [] };
}

function brain(columns) {
    return { ...createEmptyTutorialBrain(), columns };
}

function stepOneSolution() {
    return brain([column("lesson-1-move", "Always move toward opponent", 0, [
        branch("lesson-1-move-if", [always()], [move("toward")]),
    ])]);
}

function stepTwoSolution() {
    return brain([column("lesson-2-decisions", "Retreat or approach", 0, [
        branch("lesson-2-retreat-if", [compare("my.hp", "lt", 45)], [move("away"), face()]),
        branch("lesson-2-engage-else-if", [compare("target.distance", "gt", 92, "opponent")], [move("toward"), face()], "else_if", 1),
    ])]);
}

function stepThreeSolution() {
    return brain([
        column("lesson-3-face", "Turn toward opponent", 0, [branch("lesson-3-face-if", [always()], [face()])]),
        column("lesson-3-close", "Enter Heavy Slash range", 1, [
            branch("lesson-3-close-if", [compare("target.distance", "gt", 88, "opponent")], [move("toward")]),
        ]),
        column("lesson-3-slash", "Slash only when aimed", 2, [branch("lesson-3-slash-if", [
            compare("target.distance", "lte", 105, "opponent"),
            compare("target.relativeBearing", "lte", 89, "opponent"),
        ], [{ action: "heavy_slash", actionTarget: "opponent" }])]),
    ]);
}

function stepFourSolution() {
    return brain([column("lesson-4-dodge", "Dodge a nearby grenade", 0, [branch("lesson-4-dodge-if", [
        compare("target.distance", "lt", 190, "opponent_grenade"),
    ], [{ action: "micro_dash", movementMode: "target", movementDirection: "right", actionTarget: "opponent_grenade" }])])]);
}

function stepSixSolution() {
    return brain([
        ...stepFourSolution().columns,
        column("lesson-6-face", "Keep the opponent centered", 1, [branch("lesson-6-face-if", [always()], [face()])]),
        column("lesson-6-close", "Close the distance", 2, [branch("lesson-6-close-if", [
            compare("target.distance", "gt", 88, "opponent"),
        ], [move("toward")])]),
        column("lesson-6-slash", "Confirm Heavy Slash", 3, [branch("lesson-6-slash-if", [
            compare("target.distance", "lte", 105, "opponent"),
            compare("target.relativeBearing", "lte", 16, "opponent"),
        ], [{ action: "heavy_slash", actionTarget: "opponent" }])]),
    ]);
}

function stepSevenSolution() {
    return brain([
        column("lesson-7-retreat", "Protect low HP", 0, [branch("lesson-7-retreat-if", [
            compare("my.hp", "lt", 35),
        ], [move("away"), face()])]),
        column("lesson-7-approach", "Enter Sword Swing range", 1, [branch("lesson-7-approach-if", [
            compare("my.hp", "gte", 35),
            compare("target.distance", "gt", 80, "opponent"),
        ], [move("toward")])]),
        column("lesson-7-attack", "Fight while healthy", 2, [branch("lesson-7-attack-if", [
            compare("my.hp", "gte", 35),
        ], [face(), { action: "swing", actionTarget: "opponent" }])]),
    ]);
}

function passiveOpponent() {
    return createEmptyTutorialBrain();
}

function meleeOpponent() {
    return brain([column("opponent-melee", "Stationary sword pressure", 0, [
        branch("opponent-melee-if", [always()], [face(), { action: "swing", actionTarget: "opponent" }]),
    ])]);
}
function meleeOpponentNoRot() {
    return brain([column("opponent-melee", "Stationary sword pressure", 0, [
        branch("opponent-melee-if", [always()], [{ action: "swing", actionTarget: "opponent" }]),
    ])]);
}

function grenadeOpponent() {
    return brain([
        column("opponent-grenade-face", "Aim at player", 0, [branch("opponent-grenade-face-if", [always()], [face()])]),
        column("opponent-grenade-throw", "Throw grenade", 1, [branch("opponent-grenade-throw-if", [always()], [{ action: "throw_grenade", actionTarget: "opponent" }])]),
    ]);
}

const SCENARIOS = [
    { playerClass: loadout(), opponentClass: loadout(), solution: createEmptyTutorialBrain, opponentBrain: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 90 } },
    { playerClass: loadout(), opponentClass: loadout(), solution: stepOneSolution, opponentBrain: passiveOpponent, spawn: { playerY: 360, opponentY: 650, playerRotation: 90 } },
    { playerClass: loadout(), opponentClass: loadout("swing"), solution: stepTwoSolution, opponentBrain: meleeOpponent, spawn: { playerY: 420, opponentY: 560, playerRotation: 90 } },
    { playerClass: loadout("heavy_slash"), opponentClass: loadout(), solution: stepThreeSolution, opponentBrain: passiveOpponent, spawn: { playerY: 440, opponentY: 560, playerRotation: 270 } },
    { playerClass: loadout("micro_dash"), opponentClass: loadout("throw_grenade"), solution: stepFourSolution, opponentBrain: grenadeOpponent, spawn: { playerY: 420, opponentY: 570, playerRotation: 90 } },
    { playerClass: loadout("heavy_slash", "micro_dash"), opponentClass: loadout("throw_grenade"), solution: stepSixSolution, opponentBrain: grenadeOpponent, durationMs: 5000, goal: "combo", spawn: { playerY: 420, opponentY: 570, playerRotation: 270 } },
    { playerClass: loadout("swing"), opponentClass: loadout("swing"), solution: stepSevenSolution, opponentBrain: meleeOpponentNoRot, durationMs: 10000, goal: "survive", opponentHp: 1000, spawn: { playerY: 440, opponentY: 560, playerRotation: 270 } },
    { playerClass: loadout(), opponentClass: loadout(), solution: createEmptyTutorialBrain, opponentBrain: passiveOpponent, spawn: { playerY: 400, opponentY: 650, playerRotation: 90 } },
];

export function getTutorialScenario(step) {
    const source = SCENARIOS[Math.max(0, Math.min(SCENARIOS.length - 1, Number(step) || 0))];
    return { ...source, emptyBrain: createEmptyTutorialBrain(), solution: source.solution(), opponentBrain: source.opponentBrain() };
}

export function buildTutorialArenaShapes(step = 0) {
    const scenario = getTutorialScenario(step);
    const { playerY, opponentY, playerRotation } = scenario.spawn;
    const player = resetFighterShape({
        ...MAIN_SHAPE, username: "Your tutorial bot", x: 500, y: playerY, spawnX: 500, spawnY: playerY,
        rotation: playerRotation, combatClass: scenario.playerClass,
    });
    const opponent = resetFighterShape({
        ...buildOpponentShape({ username: "Tutorial opponent", selectedClass: scenario.opponentClass, slot: 2 }),
        x: 500, y: opponentY, spawnX: 500, spawnY: opponentY, rotation: 270,
        combatClass: scenario.opponentClass, locked: true,
    });
    return [player, scenario.opponentHp ? { ...opponent, hp: scenario.opponentHp, maxHp: scenario.opponentHp } : opponent];
}

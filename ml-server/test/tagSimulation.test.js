const assert = require("node:assert/strict");
const test = require("node:test");
const tf = require("@tensorflow/tfjs");
const { buildInputVector, simulateTagMatch } = require("../src/tagSimulation");

async function createZeroMoveModelArtifacts() {
    const model = tf.sequential({
        layers: [
            tf.layers.dense({
                inputShape: [60],
                units: 2,
                activation: "linear",
                kernelInitializer: "zeros",
                biasInitializer: "zeros",
            }),
        ],
    });

    let savedArtifacts = null;
    await model.save({
        save: async (artifacts) => {
            savedArtifacts = artifacts;
            return {
                modelArtifactsInfo: {
                    dateSaved: new Date(),
                    modelTopologyType: "JSON",
                },
            };
        },
    });
    model.dispose();

    return {
        modelTopology: savedArtifacts.modelTopology,
        weightSpecs: savedArtifacts.weightSpecs,
        weightDataBase64: Buffer.from(savedArtifacts.weightData).toString("base64"),
    };
}

test("buildInputVector encodes the opponent in the first feature slot", () => {
    const vector = buildInputVector(
        { x: 400, y: 400, size: 60 },
        { x: 480, y: 360, size: 60 },
    );

    assert.equal(vector.length, 60);
    assert.ok(Math.abs(vector[0] - 0.1) < 0.00001);
    assert.ok(Math.abs(vector[1] + 0.05) < 0.00001);
    assert.equal(vector[3], 1);
});

test("simulateTagMatch awards timeout wins to the runner", async () => {
    const model = await createZeroMoveModelArtifacts();

    const result = await simulateTagMatch({
        matchId: "match-1",
        rulesetVersion: "tag-v1",
        seed: 1,
        arena: {
            width: 800,
            height: 800,
            tagRadius: 60,
            durationMs: 200,
        },
        fighters: [
            {
                userId: "chaser-1",
                username: "Chaser",
                role: "CHASER",
                slot: 1,
                x: 100,
                y: 400,
                size: 60,
                model,
            },
            {
                userId: "runner-1",
                username: "Runner",
                role: "RUNNER",
                slot: 2,
                x: 700,
                y: 400,
                size: 60,
                model,
            },
        ],
    });

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.result, "RUNNER_WIN");
    assert.equal(result.winnerUserId, "runner-1");
    assert.equal(result.winnerRole, "RUNNER");
    assert.match(result.message, /wins as runner by timeout/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createModel } from "./Model.js";
import {
    createApprovedBaseArtifact,
    loadApprovedBaseModel,
} from "./BaseModelArtifact.js";

test("round-trips an approved class artifact and rejects modified weights", async () => {
    const model = createModel();
    const artifact = await createApprovedBaseArtifact({
        model,
        combatClass: "melee",
        trainingMetrics: { swingAccuracy: 0.95 },
    });
    const originalFetch = globalThis.fetch;

    try {
        globalThis.fetch = async () => ({ ok: true, json: async () => artifact });
        const loaded = await loadApprovedBaseModel("melee");
        assert.equal(loaded.artifact.baseModel.artifactId, "melee-base-v6");
        assert.equal(loaded.model.outputs.length, 5);
        assert.equal(loaded.model.outputs[0].shape.at(-1), 9);
        loaded.model.dispose();

        const tampered = structuredClone(artifact);
        const firstCharacter = tampered.model.weightDataBase64[0] === "A" ? "B" : "A";
        tampered.model.weightDataBase64 = firstCharacter + tampered.model.weightDataBase64.slice(1);
        globalThis.fetch = async () => ({ ok: true, json: async () => tampered });
        await assert.rejects(() => loadApprovedBaseModel("melee"), /integrity check failed/);
    } finally {
        globalThis.fetch = originalFetch;
        model.dispose();
    }
});

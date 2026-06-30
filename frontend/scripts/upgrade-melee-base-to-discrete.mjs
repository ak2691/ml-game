import fs from "node:fs/promises";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import { createApprovedBaseArtifact } from "../src/ml/BaseModelArtifact.js";
import { createModel } from "../src/ml/Model.js";

const sourcePath = path.resolve("public/models/melee-base-v1/melee-base-v1.base-model.json");
const destinationDirectory = path.resolve("public/models/melee-base-v2");
const destinationPath = path.join(destinationDirectory, "melee-base-v2.base-model.json");
const sourceArtifact = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const weightBytes = Buffer.from(sourceArtifact.model.weightDataBase64, "base64");
const sourceModel = await tf.loadLayersModel(tf.io.fromMemory({
    modelTopology: sourceArtifact.model.modelTopology,
    weightSpecs: sourceArtifact.model.weightSpecs,
    weightData: weightBytes.buffer.slice(
        weightBytes.byteOffset,
        weightBytes.byteOffset + weightBytes.byteLength
    ),
}));
const upgradedModel = createModel();

for (const layerName of ["hidden1", "hidden2", "rotation", "swing", "block"]) {
    const weights = sourceModel.getLayer(layerName).getWeights();
    upgradedModel.getLayer(layerName).setWeights(weights);
}

const artifact = await createApprovedBaseArtifact({
    model: upgradedModel,
    combatClass: "melee",
    trainingMetrics: sourceArtifact.training?.metrics ?? null,
    trainingRecipe: {
        ...(sourceArtifact.training?.recipe ?? {}),
        upgradedFromArtifactId: sourceArtifact.baseModel?.artifactId,
        movementHead: "nine-action-softmax",
        movementActionOrder: [
            "stop",
            "right",
            "left",
            "down",
            "up",
            "down-right",
            "up-right",
            "down-left",
            "up-left",
        ],
    },
});

await fs.mkdir(destinationDirectory, { recursive: true });
await fs.writeFile(destinationPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
sourceModel.dispose();
upgradedModel.dispose();
console.log(destinationPath);

import fs from "node:fs/promises";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import { createApprovedBaseArtifact } from "../src/ml/BaseModelArtifact.js";
import { createModel } from "../src/ml/Model.js";

const sourcePath = path.resolve("public/models/melee-base-v3/melee-base-v3.base-model.json");
const destinationDirectory = path.resolve("public/models/melee-base-v4");
const destinationPath = path.join(destinationDirectory, "melee-base-v4.base-model.json");
const sourceArtifact = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const weightBytes = Buffer.from(sourceArtifact.model.weightDataBase64, "base64");
const sourceModel = await tf.loadLayersModel(tf.io.fromMemory({
    modelTopology: sourceArtifact.model.modelTopology,
    weightSpecs: sourceArtifact.model.weightSpecs,
    weightData: weightBytes.buffer.slice(weightBytes.byteOffset, weightBytes.byteOffset + weightBytes.byteLength),
}));
const upgradedModel = createModel();

const [sourceKernel, sourceBias] = sourceModel.getLayer("hidden1").getWeights();
const [freshKernel] = upgradedModel.getLayer("hidden1").getWeights();
const expandedKernel = tf.concat([sourceKernel, freshKernel.slice([13, 0], [13, freshKernel.shape[1]])], 0);
upgradedModel.getLayer("hidden1").setWeights([expandedKernel, sourceBias]);
for (const layerName of ["hidden2", "movement", "rotation", "swing", "block"]) {
    upgradedModel.getLayer(layerName).setWeights(sourceModel.getLayer(layerName).getWeights());
}

const artifact = await createApprovedBaseArtifact({
    model: upgradedModel,
    combatClass: "melee",
    trainingMetrics: sourceArtifact.training?.metrics ?? null,
    trainingRecipe: {
        ...(sourceArtifact.training?.recipe ?? {}),
        upgradedFromArtifactId: sourceArtifact.baseModel?.artifactId,
        inputContract: "duel-logic-features-v4",
        inputCount: 26,
        outputHeads: ["movement", "rotation", "swing", "block", "dash"],
    },
});

await fs.mkdir(destinationDirectory, { recursive: true });
await fs.writeFile(destinationPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
expandedKernel.dispose();
sourceModel.dispose();
upgradedModel.dispose();
console.log(destinationPath);

import fs from "node:fs/promises";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import { createApprovedBaseArtifact } from "../src/ml/BaseModelArtifact.js";
import { createModel } from "../src/ml/Model.js";

const sourcePath = path.resolve("public/models/melee-base-v4/melee-base-v4.base-model.json");
const destinationDirectory = path.resolve("public/models/melee-base-v5");
const destinationPath = path.join(destinationDirectory, "melee-base-v5.base-model.json");
const sourceArtifact = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const weightBytes = Buffer.from(sourceArtifact.model.weightDataBase64, "base64");
const sourceModel = await tf.loadLayersModel(tf.io.fromMemory({
    modelTopology: sourceArtifact.model.modelTopology,
    weightSpecs: sourceArtifact.model.weightSpecs,
    weightData: weightBytes.buffer.slice(weightBytes.byteOffset, weightBytes.byteOffset + weightBytes.byteLength),
}));
const upgradedModel = createModel();

for (const layerName of ["hidden1", "hidden2", "rotation", "block", "dash"]) {
    upgradedModel.getLayer(layerName).setWeights(sourceModel.getLayer(layerName).getWeights());
}

const [sourceSwingKernel, sourceSwingBias] = sourceModel.getLayer("swing").getWeights();
const expandedSwingKernel = tf.concat([sourceSwingKernel, tf.zeros([16, 1])], 0);
upgradedModel.getLayer("swing").setWeights([expandedSwingKernel, sourceSwingBias]);

const artifact = await createApprovedBaseArtifact({
    model: upgradedModel,
    combatClass: "melee",
    trainingMetrics: sourceArtifact.training?.metrics ?? null,
    trainingRecipe: {
        ...(sourceArtifact.training?.recipe ?? {}),
        upgradedFromArtifactId: sourceArtifact.baseModel?.artifactId,
        isolatedStrategyLayers: ["movement_strategy", "swing_strategy"],
    },
});

await fs.mkdir(destinationDirectory, { recursive: true });
await fs.writeFile(destinationPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
expandedSwingKernel.dispose();
sourceModel.dispose();
upgradedModel.dispose();
console.log(destinationPath);

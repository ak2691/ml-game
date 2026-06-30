import fs from "node:fs/promises";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import { createApprovedBaseArtifact } from "../src/ml/BaseModelArtifact.js";
import { createModel } from "../src/ml/Model.js";

const sourcePath = path.resolve("public/models/melee-base-v2/melee-base-v2.base-model.json");
const destinationDirectory = path.resolve("public/models/melee-base-v3");
const destinationPath = path.join(destinationDirectory, "melee-base-v3.base-model.json");
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

const [sourceInputKernel, sourceInputBias] = sourceModel.getLayer("hidden1").getWeights();
const duelInputKernel = sourceInputKernel.slice([0, 0], [13, sourceInputKernel.shape[1]]);
upgradedModel.getLayer("hidden1").setWeights([duelInputKernel, sourceInputBias]);

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
        inputContract: "seven-player-plus-six-opponent-features",
        inputCount: 13,
    },
});

await fs.mkdir(destinationDirectory, { recursive: true });
await fs.writeFile(destinationPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
duelInputKernel.dispose();
sourceModel.dispose();
upgradedModel.dispose();
console.log(destinationPath);

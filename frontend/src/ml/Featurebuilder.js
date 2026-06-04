/**
 * featureBuilder.js
 *
 * Converts a raw payload from BetaModel into a flat Float32Array
 * suitable for feeding into the TensorFlow.js model.
 *
 * Input shape: [1, 60]  (MAX_OBJECTS * FEATURES_PER_OBJECT)
 *
 * Per-object feature vector (6 values):
 *   [0] relX       – (object.x - player.x) / CANVAS_SIZE   (normalized -1..1)
 *   [1] relY       – (object.y - player.y) / CANVAS_SIZE   (normalized -1..1)
 *   [2] distance   – euclidean dist / MAX_DIST             (normalized  0..1)
 *   [3] typeEnc    – type ordinal / TYPE_COUNT             (normalized  0..1)
 *   [4] sizEnc     – object.size / MAX_SIZE               (normalized  0..1)
 *   [5] rotEnc     – object.rotation / 360                (normalized  0..1)
 *
 * Slots with no object are filled with zeros (padding).
 */

const CANVAS_SIZE = 800;
const MAX_OBJECTS = 10;
const FEATURES = 6;
const MAX_DIST = Math.sqrt(2) * CANVAS_SIZE; // ~1131, diagonal of canvas
const MAX_SIZE = 200;                         // adjust to your max shape size

// Must stay consistent with how you encode shape types on the frontend
const TYPE_MAP = {
    circle: 0,
    square: 1,
    triangle: 2,
    opponentModel: 3,
    // add more types here as you add them to the toolbar
};
const TYPE_COUNT = Object.keys(TYPE_MAP).length;

/**
 * buildInputVector
 *
 * @param {Object} payload  – the exact payload object from handleSubmit:
 *   {
 *     playerModel: { x, y },
 *     reward: 1 | 0 | -1,
 *     objects: [{ id, type, x, y, size, rotation }, ...]
 *   }
 *
 * @returns {Float32Array}  length = MAX_OBJECTS * FEATURES = 60
 */
export function buildInputVector(payload) {
    const { playerModel, objects } = payload;
    const vector = new Float32Array(MAX_OBJECTS * FEATURES); // zero-filled by default

    // 1. Calculate raw distance for sorting BEFORE encoding
    const objectsWithDist = objects.map(obj => {
        const dx = obj.x - playerModel.x;
        const dy = obj.y - playerModel.y;
        return { ...obj, distSq: dx * dx + dy * dy }; // Use squared distance for fast sorting
    });

    // 2. Sort so the closest object is ALWAYS slot 0
    objectsWithDist.sort((a, b) => a.distSq - b.distSq);

    const objectsToEncode = objectsWithDist.slice(0, MAX_OBJECTS);

    // 3. Encode as normal
    objectsToEncode.forEach((obj, i) => {
        const relX = (obj.x - playerModel.x) / CANVAS_SIZE;
        const relY = (obj.y - playerModel.y) / CANVAS_SIZE;

        const absDist = Math.sqrt(obj.distSq); // We can reuse the math we did above
        const distNorm = Math.min(absDist / MAX_DIST, 1.0);

        const typeOrdinal = TYPE_MAP[obj.type] ?? 0;
        const typeNorm = typeOrdinal / Math.max(TYPE_COUNT - 1, 1);

        const sizeNorm = Math.min(obj.size / MAX_SIZE, 1.0);
        const rotNorm = ((obj.rotation % 360) + 360) % 360 / 360;

        const offset = i * FEATURES;
        vector[offset + 0] = relX;
        vector[offset + 1] = relY;
        vector[offset + 2] = distNorm;
        vector[offset + 3] = typeNorm;
        vector[offset + 4] = sizeNorm;
        vector[offset + 5] = rotNorm;
    });

    return vector;
}

export const INPUT_SIZE = MAX_OBJECTS * FEATURES; // 60 — import this into model.js

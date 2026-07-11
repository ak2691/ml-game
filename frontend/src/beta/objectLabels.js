export const OBJECT_TYPE_LABELS = Object.freeze({
    healthPack: "HP Pack",
    projectileWall: "Projectile Wall",
    bouncyWall: "Bouncy Wall",
    overdrive: "Overdrive",
    barrier: "Barrier",
    inhibition: "Inhibition",
    radarJammer: "Radar Jammer",
    commandLock: "Command Lock",
});

export function objectDisplayName(object, objects = []) {
    const baseLabel = OBJECT_TYPE_LABELS[object?.type] ?? "Object";
    const index = objectTypeIndex(object, objects);
    return `${baseLabel} #${index}`;
}

export function objectTargetTypes(baseTargets, objects = []) {
    const objectById = new Map(objects.map((object) => [object.id, object]));
    return baseTargets.flatMap((target) => {
        if (!target.id?.startsWith?.("object_")) return target;
        const object = objectById.get(target.id);
        return object ? [{ ...target, label: objectDisplayName(object, objects) }] : [];
    });
}

function objectTypeIndex(object, objects) {
    if (!object) return 1;
    const sameTypeObjects = objects.filter((candidate) => candidate?.type === object.type);
    const index = sameTypeObjects.findIndex((candidate) => candidate?.id === object.id);
    return index >= 0 ? index + 1 : sameTypeObjects.length + 1;
}

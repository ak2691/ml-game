export const PROJECTILE_WALL_TYPE = "projectileWall";
export const VANGUARD_BEACON_TYPE = "vanguardBeacon";
export const ASSAULT_BOOST_TYPE = "assaultBoost";
export const TEMPO_BOOST_TYPE = "tempoBoost";
export const MOBILITY_BOOST_TYPE = "mobilityBoost";
export const BOUNCY_WALL_TYPE = "bouncyWall";
export const OVERDRIVE_TYPE = "overdrive";
export const BARRIER_TYPE = "barrier";
export const INHIBITION_TYPE = "inhibition";
export const RADAR_JAMMER_TYPE = "radarJammer";
export const COMMAND_LOCK_TYPE = "commandLock";
export const BOUNCY_WALL_MAX_USES = 3;
export const PROJECTILE_WALL_LENGTH = 120;
export const PROJECTILE_WALL_THICKNESS = 8;
export const BUFF_PICKUP_SIZE = 76;
export const CENTER_OBJECTIVE_SIZE = 92;

export function isBoostType(type) {
    return type === ASSAULT_BOOST_TYPE || type === TEMPO_BOOST_TYPE || type === MOBILITY_BOOST_TYPE;
}

export function snapWallRotation(rotation) {
    return ((Math.round(Number(rotation || 0) / 45) * 45) % 360 + 360) % 360;
}

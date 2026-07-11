package com.example.machiner.DTO;

import java.util.List;
import java.util.UUID;

public record MatchPlaybackDTO(
        UUID matchId,
        String rulesetVersion,
        String status,
        ArenaStateDTO initialState,
        List<ReplayFrameDTO> frames,
        String result,
        UUID winnerUserId,
        String message) {

    public record ArenaStateDTO(
            int width,
            int height,
            List<FighterPlacementDTO> fighters,
            List<ObstaclePlacementDTO> obstacles) {
    }

    public record FighterPlacementDTO(
            UUID userId,
            String username,
            int slot,
            double x,
            double y,
            double rotation,
            int hp,
            String combatClass,
            boolean attackActive,
            boolean blockActive,
            Integer gunAmmo,
            Integer gunReloadMs,
            int shieldHp,
            int overdriveMs,
            int barrierImmunityMs,
            int inhibitionCharges,
            int slowedMs,
            int jammedMs,
            int commandLockedMs) {
        public FighterPlacementDTO(
                UUID userId,
                String username,
                int slot,
                double x,
                double y,
                double rotation,
                int hp,
                String combatClass,
                boolean attackActive,
                boolean blockActive,
                Integer gunAmmo,
                Integer gunReloadMs) {
            this(userId, username, slot, x, y, rotation, hp, combatClass, attackActive, blockActive, gunAmmo, gunReloadMs, 0, 0, 0, 0, 0, 0, 0);
        }
    }

    public record ObstaclePlacementDTO(
            String id,
            String type,
            double x,
            double y,
            int size,
            double rotation,
            int hp,
            int slotOneCaptureMs,
            int slotTwoCaptureMs) {
        public ObstaclePlacementDTO(String id, String type, double x, double y, int size) {
            this(id, type, x, y, size, 0.0, 0, 0, 0);
        }

        public ObstaclePlacementDTO(String id, String type, double x, double y, int size, double rotation) {
            this(id, type, x, y, size, rotation, 0, 0, 0);
        }

        public ObstaclePlacementDTO(String id, String type, double x, double y, int size, double rotation, int hp) {
            this(id, type, x, y, size, rotation, hp, 0, 0);
        }
    }

    public record ReplayFrameDTO(
            int tick,
            int elapsedMs,
            List<FighterPlacementDTO> fighters,
            List<ObstaclePlacementDTO> obstacles) {
    }
}

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
            boolean attackActive,
            boolean blockActive) {
    }

    public record ObstaclePlacementDTO(
            String id,
            String type,
            double x,
            double y,
            int size) {
    }

    public record ReplayFrameDTO(
            int tick,
            int elapsedMs,
            List<FighterPlacementDTO> fighters,
            List<ObstaclePlacementDTO> obstacles) {
    }
}

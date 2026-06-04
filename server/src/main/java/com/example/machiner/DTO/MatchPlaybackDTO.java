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
        String winnerRole,
        String message) {

    public record ArenaStateDTO(int width, int height, double tagRadius, List<FighterPlacementDTO> fighters) {
    }

    public record FighterPlacementDTO(UUID userId, String username, String role, int slot, double x, double y) {
    }

    public record ReplayFrameDTO(int tick, int elapsedMs, List<FighterPlacementDTO> fighters, boolean tagged) {
    }
}

package com.example.machiner.DTO;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record MatchmakingEventDTO(
        String type,
        UUID matchId,
        Long simulationSeed,
        String status,
        MatchmakingPlayerDTO player,
        MatchmakingPlayerDTO opponent,
        List<MatchmakingPlayerDTO> players,
        Instant serverNow,
        Instant classSelectionEndsAt,
        Instant objectPlacementEndsAt,
        Instant countdownEndsAt,
        Instant trainingEndsAt,
        Instant playbackStartsAt,
        Instant resultRevealsAt,
        String rulesetVersion,
        MatchPlaybackDTO playback,
        Integer roundNumber,
        Integer winsRequired,
        String message,
        UUID objectPlacementUserId,
        List<MatchPlaybackDTO.ObstaclePlacementDTO> objectPlacements,
        List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles,
        List<RoundBrainDTO> roundBrains,
        Boolean previousRoundWon,
        List<String> abilityOffers,
        Integer roundBlockLimit) {

    public record RoundBrainDTO(int roundNumber, JsonNode brain, boolean won) {
    }
}

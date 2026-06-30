package com.example.machiner.DTO;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record MatchmakingEventDTO(
        String type,
        UUID matchId,
        Long simulationSeed,
        String status,
        MatchmakingPlayerDTO player,
        MatchmakingPlayerDTO opponent,
        List<MatchmakingPlayerDTO> players,
        Instant serverNow,
        Instant countdownEndsAt,
        Instant trainingEndsAt,
        Instant playbackStartsAt,
        Instant resultRevealsAt,
        String rulesetVersion,
        MatchPlaybackDTO playback,
        ModelFingerprintProbeDTO probe,
        Integer roundNumber,
        Integer winsRequired,
        String message) {
}

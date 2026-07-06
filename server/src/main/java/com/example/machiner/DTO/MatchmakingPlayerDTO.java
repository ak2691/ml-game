package com.example.machiner.DTO;

import java.util.UUID;

public record MatchmakingPlayerDTO(
        UUID userId,
        String username,
        int slot,
        boolean finished,
        int roundWins,
        String selectedClass,
        boolean classSelected) {
}

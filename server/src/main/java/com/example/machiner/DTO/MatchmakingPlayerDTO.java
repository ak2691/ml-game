package com.example.machiner.DTO;

import java.util.UUID;

public record MatchmakingPlayerDTO(
        UUID userId,
        String username,
        String role,
        int slot,
        boolean finished) {
}

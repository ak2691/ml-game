package com.example.machiner.DTO;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ModelFingerprintProbeDTO(
        UUID probeId,
        UUID matchId,
        List<Integer> weightIndices,
        Instant requestedAt,
        Instant expiresAt) {
}

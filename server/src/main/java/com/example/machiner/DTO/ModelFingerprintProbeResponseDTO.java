package com.example.machiner.DTO;

import java.util.List;
import java.util.UUID;

public record ModelFingerprintProbeResponseDTO(
        UUID probeId,
        List<Double> values,
        Integer trainingStepCount) {
}

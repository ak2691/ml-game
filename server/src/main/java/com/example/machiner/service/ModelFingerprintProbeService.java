package com.example.machiner.service;

import com.example.machiner.DTO.ModelFingerprintProbeDTO;
import com.example.machiner.DTO.ModelFingerprintProbeResponseDTO;
import com.example.machiner.DTO.MatchmakingEventDTO;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
public class ModelFingerprintProbeService {

    public static final int MIN_PROBE_INTERVAL_MS = 5_000;
    public static final int MAX_PROBE_INTERVAL_MS = 15_000;
    public static final int PROBE_SAMPLE_COUNT = 128;
    public static final int EXPECTED_WEIGHT_COUNT = 5_549;
    public static final int PROBE_RESPONSE_TIMEOUT_MS = 3_000;
    public static final int MAX_FINAL_PROBE_AGE_MS = 20_000;
    public static final double MEAN_ABS_DELTA_BASE = 0.03;
    public static final double MEAN_ABS_DELTA_PER_SECOND = 0.015;
    public static final double MAX_ABS_DELTA_BASE = 0.50;
    public static final double MAX_ABS_DELTA_PER_SECOND = 0.10;
    public static final double L2_DELTA_BASE = 0.08;
    public static final double L2_DELTA_PER_SECOND = 0.025;
    private static final List<WeightSegment> WEIGHT_SEGMENTS = List.of(
            new WeightSegment("shared", 0, 3_808, 64),
            new WeightSegment("strategy", 3_808, 5_401, 16),
            new WeightSegment("rotation", 5_401, 5_434, 16),
            new WeightSegment("swing", 5_434, 5_483, 16),
            new WeightSegment("defense", 5_483, 5_549, 16));

    private final Clock clock;
    private final SecureRandom secureRandom = new SecureRandom();
    private final Map<UUID, PendingProbe> pendingProbesById = new HashMap<>();
    private final Map<UUID, CompletedProbe> latestCompletedProbeByUserId = new HashMap<>();

    public ModelFingerprintProbeService(Clock clock) {
        this.clock = clock;
    }

    public synchronized List<ScheduledProbeEvent> scheduleProbes(
            UUID matchId,
            List<ProbeTarget> targets,
            Instant trainingStartsAt,
            Instant trainingEndsAt) {
        List<ScheduledProbeEvent> events = new ArrayList<>();
        Instant now = Instant.now(clock);
        Instant probeAt = trainingStartsAt.plusMillis(nextIntervalMillis());

        while (probeAt.isBefore(trainingEndsAt)) {
            for (ProbeTarget target : targets) {
                UUID probeId = UUID.randomUUID();
                List<Integer> weightIndices = sampleWeightIndices();
                Instant expiresAt = probeAt.plusMillis(PROBE_RESPONSE_TIMEOUT_MS);
                pendingProbesById.put(probeId, new PendingProbe(
                        probeId,
                        matchId,
                        target.userId(),
                        weightIndices,
                        probeAt,
                        expiresAt));

                ModelFingerprintProbeDTO probe = new ModelFingerprintProbeDTO(
                        probeId,
                        matchId,
                        weightIndices,
                        probeAt,
                        expiresAt);
                events.add(new ScheduledProbeEvent(
                        target.principalName(),
                        probe,
                        Math.max(0, Duration.between(now, probeAt).toMillis())));
            }

            probeAt = probeAt.plusMillis(nextIntervalMillis());
        }

        return events;
    }

    public synchronized void recordProbeResponse(UUID userId, ModelFingerprintProbeResponseDTO response) {
        if (response == null || response.probeId() == null || response.values() == null) {
            return;
        }

        PendingProbe pending = pendingProbesById.get(response.probeId());
        Instant now = Instant.now(clock);
        if (pending == null || !pending.userId().equals(userId) || now.isAfter(pending.expiresAt())) {
            return;
        }
        if (response.values().size() != pending.weightIndices().size()) {
            return;
        }

        List<Double> values = new ArrayList<>();
        for (Double value : response.values()) {
            if (value == null || !Double.isFinite(value)) {
                return;
            }
            values.add(value);
        }

        pendingProbesById.remove(response.probeId());
        latestCompletedProbeByUserId.put(userId, new CompletedProbe(
                pending.probeId(),
                pending.matchId(),
                pending.userId(),
                pending.weightIndices(),
                values,
                pending.requestedAt(),
                now,
                response.trainingStepCount()));
    }

    public synchronized ProbeEvaluation evaluateFinalModel(UUID userId, JsonNode model) {
        CompletedProbe probe = latestCompletedProbeByUserId.get(userId);
        if (probe == null) {
            return ProbeEvaluation.withWarning("no completed model fingerprint probe was available");
        }

        Instant now = Instant.now(clock);
        long elapsedMillis = Math.max(0, Duration.between(probe.receivedAt(), now).toMillis());
        if (elapsedMillis > MAX_FINAL_PROBE_AGE_MS) {
            return ProbeEvaluation.withWarning("latest model fingerprint probe was too old for jump checking");
        }

        List<Double> finalValues = sampleFinalValues(model, probe.weightIndices());
        if (finalValues.isEmpty() || finalValues.size() != probe.values().size()) {
            return ProbeEvaluation.withError("model fingerprint probe could not be compared to final weights");
        }

        ProbeDelta delta = computeDelta(probe.values(), finalValues);
        Map<String, ProbeDelta> segmentDeltas = computeSegmentDeltas(
                probe.weightIndices(),
                probe.values(),
                finalValues);
        double elapsedSeconds = elapsedMillis / 1000.0;
        double allowedMeanAbsDelta = MEAN_ABS_DELTA_BASE + MEAN_ABS_DELTA_PER_SECOND * elapsedSeconds;
        double allowedMaxAbsDelta = MAX_ABS_DELTA_BASE + MAX_ABS_DELTA_PER_SECOND * elapsedSeconds;
        double allowedL2Delta = Math.sqrt(finalValues.size())
                * (L2_DELTA_BASE + L2_DELTA_PER_SECOND * elapsedSeconds);
        List<String> exceededSegments = new ArrayList<>();
        if (exceedsThresholds(delta, allowedMeanAbsDelta, allowedMaxAbsDelta, allowedL2Delta)) {
            exceededSegments.add("all");
        }

        for (Map.Entry<String, ProbeDelta> entry : segmentDeltas.entrySet()) {
            int segmentSize = sampledSegmentSize(probe.weightIndices(), entry.getKey());
            double segmentAllowedL2Delta = Math.sqrt(segmentSize)
                    * (L2_DELTA_BASE + L2_DELTA_PER_SECOND * elapsedSeconds);
            if (exceedsThresholds(entry.getValue(), allowedMeanAbsDelta, allowedMaxAbsDelta, segmentAllowedL2Delta)) {
                exceededSegments.add(entry.getKey());
            }
        }

        if (!exceededSegments.isEmpty()) {
            return ProbeEvaluation.withError(String.format(
                    "model fingerprint jump exceeded probe thresholds: segments=%s, meanAbs=%.6f/%.6f, maxAbs=%.6f/%.6f, l2=%.6f/%.6f, elapsedMs=%d",
                    String.join("|", exceededSegments),
                    delta.meanAbsDelta(),
                    allowedMeanAbsDelta,
                    delta.maxAbsDelta(),
                    allowedMaxAbsDelta,
                    delta.l2Delta(),
                    allowedL2Delta,
                    elapsedMillis));
        }

        return ProbeEvaluation.ok();
    }

    public synchronized void clearUser(UUID userId) {
        latestCompletedProbeByUserId.remove(userId);
        pendingProbesById.entrySet().removeIf(entry -> entry.getValue().userId().equals(userId));
    }

    public MatchmakingEventDTO toProbeEvent(ModelFingerprintProbeDTO probe) {
        return new MatchmakingEventDTO(
                "MODEL_PROBE_REQUEST",
                probe.matchId(),
                null,
                "PROBE_REQUESTED",
                null,
                null,
                List.of(),
                probe.requestedAt(),
                null,
                null,
                null,
                null,
                MatchSimulationService.DUEL_RULESET_VERSION,
                null,
                probe,
                null,
                null,
                "Model fingerprint probe requested.");
    }

    private int nextIntervalMillis() {
        return MIN_PROBE_INTERVAL_MS + secureRandom.nextInt(MAX_PROBE_INTERVAL_MS - MIN_PROBE_INTERVAL_MS + 1);
    }

    private List<Integer> sampleWeightIndices() {
        Set<Integer> selected = new HashSet<>();
        for (WeightSegment segment : WEIGHT_SEGMENTS) {
            int segmentSize = segment.endExclusive() - segment.startInclusive();
            int targetCount = Math.min(segment.sampleCount(), segmentSize);
            while (countSelectedInSegment(selected, segment) < targetCount) {
                selected.add(segment.startInclusive() + secureRandom.nextInt(segmentSize));
            }
        }
        return new ArrayList<>(selected);
    }

    private int countSelectedInSegment(Set<Integer> selected, WeightSegment segment) {
        int count = 0;
        for (Integer index : selected) {
            if (segment.contains(index)) {
                count++;
            }
        }
        return count;
    }

    private ProbeDelta computeDelta(List<Double> probeValues, List<Double> finalValues) {
        double sumAbs = 0.0;
        double sumSquared = 0.0;
        double maxAbs = 0.0;
        for (int i = 0; i < probeValues.size(); i++) {
            double absDelta = Math.abs(finalValues.get(i) - probeValues.get(i));
            sumAbs += absDelta;
            sumSquared += absDelta * absDelta;
            maxAbs = Math.max(maxAbs, absDelta);
        }

        return new ProbeDelta(
                sumAbs / probeValues.size(),
                maxAbs,
                Math.sqrt(sumSquared));
    }

    private Map<String, ProbeDelta> computeSegmentDeltas(
            List<Integer> weightIndices,
            List<Double> probeValues,
            List<Double> finalValues) {
        Map<String, List<Double>> probeValuesBySegment = new HashMap<>();
        Map<String, List<Double>> finalValuesBySegment = new HashMap<>();

        for (int i = 0; i < weightIndices.size(); i++) {
            String segmentName = segmentNameForIndex(weightIndices.get(i));
            if (segmentName == null) {
                continue;
            }
            probeValuesBySegment.computeIfAbsent(segmentName, ignored -> new ArrayList<>()).add(probeValues.get(i));
            finalValuesBySegment.computeIfAbsent(segmentName, ignored -> new ArrayList<>()).add(finalValues.get(i));
        }

        Map<String, ProbeDelta> deltas = new HashMap<>();
        for (Map.Entry<String, List<Double>> entry : probeValuesBySegment.entrySet()) {
            List<Double> finalSegmentValues = finalValuesBySegment.get(entry.getKey());
            if (finalSegmentValues != null && !entry.getValue().isEmpty()) {
                deltas.put(entry.getKey(), computeDelta(entry.getValue(), finalSegmentValues));
            }
        }
        return deltas;
    }

    private int sampledSegmentSize(List<Integer> weightIndices, String segmentName) {
        int count = 0;
        for (Integer index : weightIndices) {
            if (segmentName.equals(segmentNameForIndex(index))) {
                count++;
            }
        }
        return count;
    }

    private boolean exceedsThresholds(
            ProbeDelta delta,
            double allowedMeanAbsDelta,
            double allowedMaxAbsDelta,
            double allowedL2Delta) {
        int exceededChecks = 0;
        if (delta.meanAbsDelta() > allowedMeanAbsDelta) {
            exceededChecks++;
        }
        if (delta.maxAbsDelta() > allowedMaxAbsDelta) {
            exceededChecks++;
        }
        if (delta.l2Delta() > allowedL2Delta) {
            exceededChecks++;
        }
        return exceededChecks >= 2;
    }

    private String segmentNameForIndex(Integer index) {
        if (index == null) {
            return null;
        }

        for (WeightSegment segment : WEIGHT_SEGMENTS) {
            if (segment.contains(index)) {
                return segment.name();
            }
        }
        return null;
    }

    private List<Double> sampleFinalValues(JsonNode model, List<Integer> weightIndices) {
        Optional<float[]> weights = decodeFloat32Weights(model);
        if (weights.isEmpty()) {
            return List.of();
        }

        float[] allWeights = weights.get();
        List<Double> values = new ArrayList<>();
        for (Integer index : weightIndices) {
            if (index == null || index < 0 || index >= allWeights.length) {
                return List.of();
            }
            values.add((double) allWeights[index]);
        }
        return values;
    }

    private Optional<float[]> decodeFloat32Weights(JsonNode model) {
        if (model == null || !model.isObject()
                || !model.hasNonNull("weightDataBase64")
                || !model.get("weightDataBase64").isTextual()) {
            return Optional.empty();
        }

        try {
            byte[] bytes = Base64.getDecoder().decode(model.get("weightDataBase64").asString(""));
            if (bytes.length % Float.BYTES != 0) {
                return Optional.empty();
            }
            ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
            float[] weights = new float[bytes.length / Float.BYTES];
            for (int i = 0; i < weights.length; i++) {
                weights[i] = buffer.getFloat();
            }
            return Optional.of(weights);
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }

    public record ProbeTarget(UUID userId, String principalName) {
    }

    public record ScheduledProbeEvent(String principalName, ModelFingerprintProbeDTO probe, long delayMillis) {
    }

    private record PendingProbe(
            UUID probeId,
            UUID matchId,
            UUID userId,
            List<Integer> weightIndices,
            Instant requestedAt,
            Instant expiresAt) {
    }

    private record CompletedProbe(
            UUID probeId,
            UUID matchId,
            UUID userId,
            List<Integer> weightIndices,
            List<Double> values,
            Instant requestedAt,
            Instant receivedAt,
            Integer trainingStepCount) {
    }

    private record ProbeDelta(double meanAbsDelta, double maxAbsDelta, double l2Delta) {
    }

    private record WeightSegment(String name, int startInclusive, int endExclusive, int sampleCount) {

        private boolean contains(Integer index) {
            return index != null && index >= startInclusive && index < endExclusive;
        }
    }

    public record ProbeEvaluation(boolean accepted, List<String> errors, List<String> warnings) {

        public static ProbeEvaluation ok() {
            return new ProbeEvaluation(true, List.of(), List.of());
        }

        public static ProbeEvaluation withWarning(String warning) {
            return new ProbeEvaluation(true, List.of(), List.of(warning));
        }

        public static ProbeEvaluation withError(String error) {
            return new ProbeEvaluation(false, List.of(error), List.of());
        }
    }
}

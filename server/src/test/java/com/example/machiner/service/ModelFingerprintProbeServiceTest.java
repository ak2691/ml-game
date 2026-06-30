package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.machiner.DTO.ModelFingerprintProbeResponseDTO;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class ModelFingerprintProbeServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();

    @Test
    void schedulesProbeRequestsInsideTrainingWindow() {
        MutableClock clock = new MutableClock(Instant.parse("2026-06-05T12:00:00Z"));
        ModelFingerprintProbeService service = new ModelFingerprintProbeService(clock);

        List<ModelFingerprintProbeService.ScheduledProbeEvent> probes = service.scheduleProbes(
                UUID.randomUUID(),
                List.of(new ModelFingerprintProbeService.ProbeTarget(
                        UUID.randomUUID(),
                        "pilot@example.com")),
                Instant.parse("2026-06-05T12:00:05Z"),
                Instant.parse("2026-06-05T12:01:05Z"));

        assertThat(probes).isNotEmpty();
        assertThat(probes).allSatisfy(probe -> {
            assertThat(probe.delayMillis()).isBetween(5_000L, 65_000L);
            assertThat(probe.probe().weightIndices()).hasSize(ModelFingerprintProbeService.PROBE_SAMPLE_COUNT);
            assertThat(probe.probe().weightIndices()).allSatisfy(index ->
                    assertThat(index).isBetween(0, ModelFingerprintProbeService.EXPECTED_WEIGHT_COUNT - 1));
            assertThat(probe.probe().weightIndices().stream().filter(index -> index >= 0 && index < 3_808).count())
                    .isEqualTo(64);
            assertThat(probe.probe().weightIndices().stream().filter(index -> index >= 3_808 && index < 5_401).count())
                    .isEqualTo(16);
            assertThat(probe.probe().weightIndices().stream().filter(index -> index >= 5_401 && index < 5_434).count())
                    .isEqualTo(16);
            assertThat(probe.probe().weightIndices().stream().filter(index -> index >= 5_434 && index < 5_483).count())
                    .isEqualTo(16);
            assertThat(probe.probe().weightIndices().stream().filter(index -> index >= 5_483 && index < 5_549).count())
                    .isEqualTo(16);
        });
    }

    @Test
    void acceptsFinalWeightsThatMatchLatestProbe() throws Exception {
        MutableClock clock = new MutableClock(Instant.parse("2026-06-05T12:00:00Z"));
        ModelFingerprintProbeService service = new ModelFingerprintProbeService(clock);
        UUID userId = UUID.randomUUID();
        var probe = service.scheduleProbes(
                UUID.randomUUID(),
                List.of(new ModelFingerprintProbeService.ProbeTarget(userId, "pilot@example.com")),
                Instant.parse("2026-06-05T12:00:05Z"),
                Instant.parse("2026-06-05T12:00:30Z")).get(0).probe();

        service.recordProbeResponse(userId, new ModelFingerprintProbeResponseDTO(
                probe.probeId(),
                probe.weightIndices().stream().map(index -> 0.0).toList(),
                3));

        var result = service.evaluateFinalModel(userId, modelWithUniformWeights(0.0f));

        assertThat(result.accepted()).isTrue();
        assertThat(result.errors()).isEmpty();
    }

    @Test
    void rejectsLargeProbeToFinalWeightJump() throws Exception {
        MutableClock clock = new MutableClock(Instant.parse("2026-06-05T12:00:00Z"));
        ModelFingerprintProbeService service = new ModelFingerprintProbeService(clock);
        UUID userId = UUID.randomUUID();
        var probe = service.scheduleProbes(
                UUID.randomUUID(),
                List.of(new ModelFingerprintProbeService.ProbeTarget(userId, "pilot@example.com")),
                Instant.parse("2026-06-05T12:00:05Z"),
                Instant.parse("2026-06-05T12:00:30Z")).get(0).probe();

        service.recordProbeResponse(userId, new ModelFingerprintProbeResponseDTO(
                probe.probeId(),
                probe.weightIndices().stream().map(index -> 0.0).toList(),
                3));

        var result = service.evaluateFinalModel(userId, modelWithUniformWeights(10.0f));

        assertThat(result.accepted()).isFalse();
        assertThat(result.errors()).singleElement().asString()
                .contains("model fingerprint jump exceeded probe thresholds");
    }

    @Test
    void rejectsSingleHeadJumpEvenWhenGlobalAggregateIsSmall() throws Exception {
        MutableClock clock = new MutableClock(Instant.parse("2026-06-05T12:00:00Z"));
        ModelFingerprintProbeService service = new ModelFingerprintProbeService(clock);
        UUID userId = UUID.randomUUID();
        var probe = service.scheduleProbes(
                UUID.randomUUID(),
                List.of(new ModelFingerprintProbeService.ProbeTarget(userId, "pilot@example.com")),
                Instant.parse("2026-06-05T12:00:05Z"),
                Instant.parse("2026-06-05T12:00:30Z")).get(0).probe();

        service.recordProbeResponse(userId, new ModelFingerprintProbeResponseDTO(
                probe.probeId(),
                probe.weightIndices().stream().map(index -> 0.0).toList(),
                3));

        var result = service.evaluateFinalModel(userId, modelWithSwingHeadWeights(0.2f));

        assertThat(result.accepted()).isFalse();
        assertThat(result.errors()).singleElement().asString()
                .contains("segments=swing");
    }

    private JsonNode modelWithUniformWeights(float value) throws Exception {
        float[] weights = new float[ModelFingerprintProbeService.EXPECTED_WEIGHT_COUNT];
        for (int i = 0; i < weights.length; i++) {
            weights[i] = value;
        }
        return modelWithWeights(weights);
    }

    private JsonNode modelWithSwingHeadWeights(float value) throws Exception {
        float[] weights = new float[ModelFingerprintProbeService.EXPECTED_WEIGHT_COUNT];
        for (int i = 5_434; i < 5_483; i++) {
            weights[i] = value;
        }
        return modelWithWeights(weights);
    }

    private JsonNode modelWithWeights(float[] weights) throws Exception {
        ByteBuffer buffer = ByteBuffer
                .allocate(weights.length * Float.BYTES)
                .order(ByteOrder.LITTLE_ENDIAN);
        for (float weight : weights) {
            buffer.putFloat(weight);
        }

        String encodedWeights = Base64.getEncoder().encodeToString(buffer.array());
        return jsonMapper.readTree("""
                {
                  "modelTopology": {},
                  "weightSpecs": [],
                  "weightDataBase64": "%s"
                }
                """.formatted(encodedWeights));
    }

    private static final class MutableClock extends Clock {

        private final Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}

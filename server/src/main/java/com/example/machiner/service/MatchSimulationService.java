package com.example.machiner.service;

import com.example.machiner.DTO.MatchPlaybackDTO;
import com.example.machiner.domain.ModelSubmission;
import com.example.machiner.service.MatchmakingService.MatchPlayer;
import com.example.machiner.service.MatchmakingService.MatchSession;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MatchSimulationService {

    public static final String DUEL_RULESET_VERSION = "duel-v1";
    private static final int ARENA_SIZE = 800;
    private static final int FIGHTER_SIZE = 60;
    private static final int SIMULATION_DURATION_MS = 30_000;

    private final URI simulationUri;
    private final JsonMapper jsonMapper;
    private final HttpClient httpClient;

    public MatchSimulationService(
            @Value("${machiner.ml-server.url:http://localhost:3000}") String mlServerUrl,
            JsonMapper jsonMapper) {
        this.simulationUri = URI.create(trimTrailingSlash(mlServerUrl) + "/api/duel-v1/simulate");
        this.jsonMapper = jsonMapper;
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    }

    public MatchPlaybackDTO buildDuelPlayback(
            MatchSession session,
            Map<UUID, ModelSubmission> submissionsByUserId) {
        try {
            DuelSimulationRequest request = toRequest(session, submissionsByUserId);
            HttpRequest httpRequest = HttpRequest.newBuilder(simulationUri)
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonMapper.writeValueAsString(request)))
                    .build();
            HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return failedPlayback(session, "ML simulation failed with HTTP " + response.statusCode());
            }
            return jsonMapper.readValue(response.body(), MatchPlaybackDTO.class);
        } catch (Exception ex) {
            return failedPlayback(session, "ML simulation failed: " + ex.getClass().getSimpleName());
        }
    }

    private DuelSimulationRequest toRequest(
            MatchSession session,
            Map<UUID, ModelSubmission> submissionsByUserId) {
        List<DuelFighterRequest> fighters = session.players().stream()
                .map(player -> toFighterRequest(player, submissionsByUserId.get(player.userId())))
                .toList();
        return new DuelSimulationRequest(
                session.matchId(),
                DUEL_RULESET_VERSION,
                session.simulationSeed(),
                new DuelArenaRequest(ARENA_SIZE, ARENA_SIZE, SIMULATION_DURATION_MS),
                fighters);
    }

    private DuelFighterRequest toFighterRequest(MatchPlayer player, ModelSubmission submission) {
        double x = player.slot() == 1 ? 240.0 : 560.0;
        return new DuelFighterRequest(
                player.userId(),
                player.username(),
                player.slot(),
                x,
                ARENA_SIZE / 2.0,
                player.slot() == 1 ? 0 : 180,
                FIGHTER_SIZE,
                readModelArtifacts(submission),
                readStrategyConfiguration(submission));
    }

    private JsonNode readModelArtifacts(ModelSubmission submission) {
        if (submission == null || submission.getModelArtifacts() == null || submission.getModelArtifacts().isBlank()) {
            return jsonMapper.createObjectNode();
        }
        try {
            return jsonMapper.readTree(submission.getModelArtifacts());
        } catch (Exception ex) {
            return jsonMapper.createObjectNode();
        }
    }

    private JsonNode readStrategyConfiguration(ModelSubmission submission) {
        if (submission == null || submission.getTrainingMetrics() == null || submission.getTrainingMetrics().isBlank()) {
            return jsonMapper.createObjectNode();
        }
        try {
            JsonNode metrics = jsonMapper.readTree(submission.getTrainingMetrics());
            JsonNode configuration = metrics.get("configuration");
            return configuration != null && configuration.isObject()
                    ? configuration
                    : jsonMapper.createObjectNode();
        } catch (Exception ex) {
            return jsonMapper.createObjectNode();
        }
    }

    private MatchPlaybackDTO failedPlayback(MatchSession session, String message) {
        List<MatchPlaybackDTO.FighterPlacementDTO> fighters = session.players().stream()
                .map(player -> new MatchPlaybackDTO.FighterPlacementDTO(
                        player.userId(),
                        player.username(),
                        player.slot(),
                        player.slot() == 1 ? 240.0 : 560.0,
                        ARENA_SIZE / 2.0,
                        player.slot() == 1 ? 0 : 180,
                        100,
                        false,
                        false))
                .toList();
        return new MatchPlaybackDTO(
                session.matchId(),
                DUEL_RULESET_VERSION,
                "FAILED",
                new MatchPlaybackDTO.ArenaStateDTO(ARENA_SIZE, ARENA_SIZE, fighters, List.of()),
                List.of(),
                "ERROR",
                null,
                message);
    }

    private static String trimTrailingSlash(String value) {
        if (value == null || value.isBlank()) return "http://localhost:3000";
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    private record DuelSimulationRequest(
            UUID matchId,
            String rulesetVersion,
            long seed,
            DuelArenaRequest arena,
            List<DuelFighterRequest> fighters) {
    }

    private record DuelArenaRequest(int width, int height, int durationMs) {
    }

    private record DuelFighterRequest(
            UUID userId,
            String username,
            int slot,
            double x,
            double y,
            double rotation,
            int size,
            JsonNode model,
            JsonNode strategy) {
    }
}

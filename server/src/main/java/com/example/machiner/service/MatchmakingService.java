package com.example.machiner.service;

import com.example.machiner.DTO.MatchPlaybackDTO;
import com.example.machiner.DTO.MatchmakingEventDTO;
import com.example.machiner.DTO.MatchmakingPlayerDTO;
import com.example.machiner.DTO.MatchmakingEventDTO.RoundBrainDTO;
import com.example.machiner.domain.AppUser;
import com.example.machiner.domain.Match;
import com.example.machiner.domain.MatchParticipant;
import com.example.machiner.domain.MatchResult;
import com.example.machiner.domain.MatchStatus;
import com.example.machiner.domain.ModelSubmission;
import com.example.machiner.domain.ModelSubmissionStatus;
import com.example.machiner.domain.Profile;
import com.example.machiner.repository.MatchParticipantRepository;
import com.example.machiner.repository.MatchRepository;
import com.example.machiner.repository.ModelSubmissionRepository;
import com.example.machiner.repository.ProfileRepository;
import com.example.machiner.repository.UserRepository;
import com.example.machiner.simulation.ArenaUnits;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MatchmakingService {

    private static final int COUNTDOWN_SECONDS = 5;
    private static final long PLAYBACK_PREP_DELAY_MILLIS = 3_000L;
    private static final long ROUND_RESULT_HOLD_MILLIS = 3_500L;
    private static final int CLASS_SELECTION_SECONDS = 60;
    private static final int TRAINING_SECONDS = 600;
    private static final int RESULT_REVEAL_BUFFER_MS = 250;
    private static final int WINS_REQUIRED = 2;
    private static final int TOTAL_ROUNDS = 3;
    private static final Map<Integer, Integer> ROUND_OFFER_COUNTS = Map.of(1, 6, 2, 4, 3, 3);
    private static final Map<Integer, Integer> ROUND_PICK_COUNTS = Map.of(1, 3, 2, 2, 3, 1);
    private static final Map<Integer, List<String>> ROUND_ABILITIES = Map.of(
            1, List.of("swing", "block", "dash", "fire_gun", "throw_grenade", "shoot_fireball", "stun", "heavy_slash", "repulsor_burst", "concussive_shot", "repair_pulse", "proximity_mine", "quick_jab", "pistol_shot"),
            2, List.of("rail_shot", "gravity_grenade", "silence_pulse", "reactive_armor", "hunter_drone", "thrust", "micro_dash"),
            3, List.of("temporal_rewind", "orbital_strike", "absolute_guard", "null_zone", "phase_strike"));
    private static final Map<String, String> ABILITY_CODES = Map.ofEntries(
            Map.entry("swing", "s"), Map.entry("block", "b"), Map.entry("dash", "d"), Map.entry("fire_gun", "g"),
            Map.entry("throw_grenade", "r"), Map.entry("shoot_fireball", "f"), Map.entry("stun", "t"), Map.entry("heavy_slash", "h"),
            Map.entry("repulsor_burst", "u"), Map.entry("concussive_shot", "c"), Map.entry("repair_pulse", "e"), Map.entry("proximity_mine", "m"),
            Map.entry("quick_jab", "j"), Map.entry("pistol_shot", "p"), Map.entry("rail_shot", "R"), Map.entry("gravity_grenade", "G"),
            Map.entry("silence_pulse", "S"), Map.entry("reactive_armor", "A"), Map.entry("hunter_drone", "H"), Map.entry("thrust", "T"),
            Map.entry("micro_dash", "M"), Map.entry("temporal_rewind", "w"), Map.entry("orbital_strike", "o"), Map.entry("absolute_guard", "a"),
            Map.entry("null_zone", "n"), Map.entry("phase_strike", "P"));
    private static final int ROUND_LOGIC_BLOCK_LIMIT = 100;
    private static final String COMPLETION_REASON_SIMULATION = "SIMULATION";
    private static final String COMPLETION_REASON_RESIGNATION = "RESIGNATION";

    private final MatchSimulationService matchSimulationService;
    private final MatchRepository matchRepository;
    private final MatchParticipantRepository matchParticipantRepository;
    private final ModelSubmissionRepository modelSubmissionRepository;
    private final ProfileRepository profileRepository;
    private final UserRepository userRepository;
    private final Clock clock;
    private final List<QueuedPlayer> queue = new ArrayList<>();
    private final Map<UUID, MatchSession> activeSessionsByUserId = new HashMap<>();
    private final Map<UUID, List<RoundSubmissionRecord>> roundHistoryByMatchId = new HashMap<>();
    private final JsonMapper jsonMapper = new JsonMapper();

    public MatchmakingService(
            MatchSimulationService matchSimulationService,
            MatchRepository matchRepository,
            MatchParticipantRepository matchParticipantRepository,
            ModelSubmissionRepository modelSubmissionRepository,
            ProfileRepository profileRepository,
            UserRepository userRepository,
            Clock clock) {
        this.matchSimulationService = matchSimulationService;
        this.matchRepository = matchRepository;
        this.matchParticipantRepository = matchParticipantRepository;
        this.modelSubmissionRepository = modelSubmissionRepository;
        this.profileRepository = profileRepository;
        this.userRepository = userRepository;
        this.clock = clock;
    }

    @Transactional
    public synchronized List<OutboundMatchmakingEvent> joinQueue(
            UUID userId,
            String username,
            String principalName) {
        if (activeSessionsByUserId.containsKey(userId)) {
            MatchSession session = activeSessionsByUserId.get(userId);
            return List.of(eventForPlayer(session, playerForUser(session, userId), "MATCH_FOUND"));
        }

        if (queue.stream().anyMatch(player -> player.userId().equals(userId))) {
            return List.of(waitingEvent(userId, username, principalName));
        }

        QueuedPlayer player = new QueuedPlayer(userId, username, principalName);
        if (queue.isEmpty()) {
            queue.add(player);
            return List.of(waitingEvent(userId, username, principalName));
        }

        QueuedPlayer opponent = queue.remove(0);
        Instant classSelectionEndsAt = Instant.now(clock).plusSeconds(CLASS_SELECTION_SECONDS);
        Match match = createMatch(opponent, player);
        long seed = match.getSimulationSeed();
        boolean queuedPlayerDefendsFirst = (seed & 1L) == 0L;
        QueuedPlayer firstDefender = queuedPlayerDefendsFirst ? player : opponent;
        QueuedPlayer firstAttacker = queuedPlayerDefendsFirst ? opponent : player;
        List<MatchPlayer> players = List.of(
                new MatchPlayer(
                        firstDefender.userId(), firstDefender.username(), firstDefender.principalName(),
                        1,
                        false,
                        null,
                        0,
                        "custom::0,0,0,0",
                        false),
                new MatchPlayer(
                        firstAttacker.userId(), firstAttacker.username(), firstAttacker.principalName(),
                        2,
                        false,
                        null,
                        0,
                        "custom::0,0,0,0",
                        false));

        MatchSession pendingSession = new MatchSession(
                match.getId(),
                seed,
                players,
                classSelectionEndsAt,
                null,
                null,
                null,
                1,
                WINS_REQUIRED,
                List.of(),
                Map.of());
        MatchSession session = pendingSession;
        createParticipants(match, session);
        activeSessionsByUserId.put(opponent.userId(), session);
        activeSessionsByUserId.put(player.userId(), session);

        List<OutboundMatchmakingEvent> events = new ArrayList<>(session.players().stream()
                .map(matchPlayer -> eventForPlayer(session, matchPlayer, "MATCH_FOUND"))
                .toList());
        return events;
    }

    @Transactional
    public synchronized List<OutboundMatchmakingEvent> selectClass(UUID userId, String selectedClass) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null) {
            return List.of();
        }
        if (session.countdownEndsAt() != null) {
            return List.of(eventForPlayer(session, playerForUser(session, userId), "MATCH_COUNTDOWN_READY"));
        }

        String normalizedLoadout = normalizeSelectedClass(selectedClass);
        validateRoundLoadoutBudget(normalizedLoadout, session.roundNumber());
        validateRoundAbilityDraft(session, playerForUser(session, userId), normalizedLoadout);
        MatchSession selectedSession = session.withSelectedClass(userId, normalizedLoadout, true);
        if (selectedSession.players().stream().allMatch(MatchPlayer::classSelected)) {
            return startCountdown(selectedSession.withObstacles(List.of()), "MATCH_COUNTDOWN_READY", "Both loadouts locked.");
        }

        for (MatchPlayer player : selectedSession.players()) {
            activeSessionsByUserId.put(player.userId(), selectedSession);
        }
        return selectedSession.players().stream()
                .map(player -> eventForPlayer(
                        selectedSession,
                        player,
                        "MATCH_CLASS_SELECTED",
                        "CLASS_SELECT",
                        null,
                        playerForUser(selectedSession, userId).username() + " locked a loadout."))
                .toList();
    }

    @Transactional
    public synchronized List<OutboundMatchmakingEvent> resolveClassSelectionTimeout(UUID matchId) {
        MatchSession session = activeSessionsByUserId.values().stream()
                .filter(candidate -> candidate.matchId().equals(matchId))
                .findFirst()
                .orElse(null);
        if (session == null || session.countdownEndsAt() != null) {
            return List.of();
        }
        if (session.classSelectionEndsAt() != null && Instant.now(clock).isBefore(session.classSelectionEndsAt())) {
            return List.of();
        }
        return startCountdown(withDefaultAbilitySelections(session).withObstacles(List.of()), "MATCH_COUNTDOWN_READY", "Loadout selection ended.");
    }

    @Transactional
    public synchronized List<OutboundMatchmakingEvent> submitObjectPlacements(
            UUID userId,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> objects) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null || session.objectPlacementEndsAt() == null || session.countdownEndsAt() != null) {
            return List.of();
        }
        MatchPlayer submittingPlayer = playerForUser(session, userId);
        if (submittingPlayer.slot() != 2) {
            throw new AuthException("only the attacker may place match objects");
        }
        List<MatchPlaybackDTO.ObstaclePlacementDTO> normalizedObjects =
                normalizeObjectPlacements(submittingPlayer, objects);
        MatchSession placedSession = session.withObjectPlacements(
                userId,
                normalizedObjects);
        boolean allSubmitted = placedSession.players().stream()
                .allMatch(player -> placedSession.objectPlacementsByUserId().containsKey(player.userId()));
        if (allSubmitted) {
            return startCountdown(placedSession.withObstacles(combinedObjectPlacements(placedSession)),
                    "MATCH_COUNTDOWN_READY",
                    "Both object layouts locked.");
        }
        for (MatchPlayer player : placedSession.players()) {
            activeSessionsByUserId.put(player.userId(), placedSession);
        }
        return placedSession.players().stream()
                .map(player -> eventForPlayer(
                        placedSession,
                        player,
                        "PLAYER_OBJECTS_PLACED",
                        "OBJECT_PLACEMENT",
                        null,
                        submittingPlayer.username() + " placed objects.",
                        submittingPlayer.userId(),
                        player.userId().equals(submittingPlayer.userId()) ? normalizedObjects : List.of()))
                .toList();
    }

    @Transactional
    public synchronized List<OutboundMatchmakingEvent> resolveObjectPlacementTimeout(UUID matchId) {
        MatchSession session = activeSessionsByUserId.values().stream()
                .filter(candidate -> candidate.matchId().equals(matchId))
                .findFirst()
                .orElse(null);
        if (session == null || session.objectPlacementEndsAt() == null || session.countdownEndsAt() != null) {
            return List.of();
        }
        if (Instant.now(clock).isBefore(session.objectPlacementEndsAt())) {
            return List.of();
        }
        return startCountdown(session.withObstacles(combinedObjectPlacements(session)),
                "MATCH_COUNTDOWN_READY",
                "Object placement ended.");
    }

    public synchronized void leaveQueue(UUID userId) {
        queue.removeIf(player -> player.userId().equals(userId));
    }

    public synchronized void requireActiveMatchForUser(UUID userId, UUID matchId) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null || matchId == null || !session.matchId().equals(matchId)) {
            throw new AuthException("user is not active in this match");
        }
        playerForUser(session, userId);
    }

    @Transactional
    public synchronized List<OutboundMatchmakingEvent> surrender(UUID userId) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null) {
            leaveQueue(userId);
            return List.of();
        }

        MatchPlayer resigningPlayer = playerForUser(session, userId);
        MatchPlayer winner = session.players().stream()
                .filter(player -> !player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("opponent was not found"));

        completeMatchByResignation(session.matchId(), resigningPlayer, winner);
        for (MatchPlayer player : session.players()) {
            activeSessionsByUserId.remove(player.userId());
        }

        MatchPlaybackDTO result = new MatchPlaybackDTO(
                session.matchId(),
                MatchSimulationService.DUEL_RULESET_VERSION,
                "COMPLETED",
                null,
                List.of(),
                "RESIGNATION_WIN",
                winner.userId(),
                winner.username() + " wins by resignation.");
        Instant now = Instant.now(clock);

        return session.players().stream()
                .map(player -> eventForPlayer(
                        session,
                        player,
                        "MATCH_RESULT_READY",
                        "RESULT_READY",
                        result,
                        result.message(),
                        0,
                        now,
                        now))
                .toList();
    }

    @Transactional
    public synchronized List<OutboundMatchmakingEvent> markFinished(UUID userId, UUID modelSubmissionId) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null) {
            return List.of();
        }

        ModelSubmission submission = requireValidatedSubmission(userId, modelSubmissionId, session.matchId());
        MatchPlayer submittingPlayer = playerForUser(session, userId);
        String submissionClass = normalizeSelectedClass(submission.getSelectedClass());
        String submittedLoadout = submissionLoadoutId(submission);
        if (submittedLoadout != null && !submittedLoadout.equals(submittingPlayer.selectedClass())) {
            throw new AuthException("model submission does not match the selected bot loadout");
        }
        if (submittedLoadout == null && !"custom:bds:0,0,0,0".equals(submissionClass) && !"custom".equals(submissionClass)
                && !submissionClass.equals(submittingPlayer.selectedClass())) {
            throw new AuthException("model submission does not match the selected bot loadout");
        }
        MatchSession updatedSession = session.withFinishedPlayer(userId, submission.getId());
        for (MatchPlayer player : updatedSession.players()) {
            activeSessionsByUserId.put(player.userId(), updatedSession);
        }

        attachSubmission(updatedSession.matchId(), userId, submission);

        boolean allFinished = updatedSession.players().stream().allMatch(MatchPlayer::finished);
        if (!allFinished) {
            return updatedSession.players().stream()
                    .map(player -> eventForPlayer(
                            updatedSession,
                            player,
                            "PLAYER_FINISHED",
                            "WAITING_FOR_FINISH",
                            null,
                            playerForUser(updatedSession, userId).username() + " finished training."))
                    .toList();
        }

        Map<UUID, ModelSubmission> submissionsByUserId = loadFinishedSubmissions(updatedSession);
        MatchPlaybackDTO playback = matchSimulationService.buildDuelPlayback(updatedSession, submissionsByUserId);
        MatchSession scoredSession = updatedSession.withRoundResult(playback.winnerUserId());
        roundHistoryByMatchId.computeIfAbsent(session.matchId(), ignored -> new ArrayList<>())
                .add(new RoundSubmissionRecord(
                        session.roundNumber(),
                        playback.winnerUserId(),
                        Map.copyOf(submissionsByUserId),
                        roundLossScores(session, playback)));
        boolean seriesComplete = session.roundNumber() >= TOTAL_ROUNDS
                || scoredSession.players().stream().anyMatch(player -> player.roundWins() >= WINS_REQUIRED);
        if (seriesComplete) {
            UUID seriesWinner = seriesWinner(scoredSession);
            playback = withWinner(playback, seriesWinner,
                    seriesWinner == null ? "The best-of-three match ended tied." : playerForUser(scoredSession, seriesWinner).username() + " wins the best-of-three match.");
            completeMatch(scoredSession.matchId(), playback);

            for (MatchPlayer player : scoredSession.players()) {
                activeSessionsByUserId.remove(player.userId());
            }
        }
        MatchPlaybackDTO replayOnlyPlayback = withoutResult(playback);
        MatchPlaybackDTO resultOnlyPlayback = resultOnly(playback);
        long replayDurationMillis = resultRevealDelayMillis(playback);
        long resultDelayMillis = PLAYBACK_PREP_DELAY_MILLIS + replayDurationMillis;
        Instant playbackStartsAt = Instant.now(clock).plusMillis(PLAYBACK_PREP_DELAY_MILLIS);
        Instant resultRevealsAt = playbackStartsAt.plusMillis(replayDurationMillis);
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchPlayer player : scoredSession.players()) {
            events.add(eventForPlayer(
                    scoredSession,
                    player,
                    "MATCH_PLAYBACK_READY",
                    "READY_FOR_PLAYBACK",
                    replayOnlyPlayback,
                    "Replay ready.",
                    0,
                    playbackStartsAt,
                    resultRevealsAt));
            events.add(eventForPlayer(
                    scoredSession,
                    player,
                    "MATCH_RESULT_READY",
                    "RESULT_READY",
                    resultOnlyPlayback,
                    playback.message(),
                    resultDelayMillis,
                    playbackStartsAt,
                    resultRevealsAt));
        }
        if (!seriesComplete) {
            MatchSession nextRoundSession = scoredSession.nextRound()
                    .withClassSelection(resultRevealsAt
                            .plusMillis(ROUND_RESULT_HOLD_MILLIS)
                            .plusSeconds(CLASS_SELECTION_SECONDS));
            for (MatchPlayer player : nextRoundSession.players()) {
                activeSessionsByUserId.put(player.userId(), nextRoundSession);
                events.add(eventForPlayer(
                        nextRoundSession,
                        player,
                        "MATCH_ROUND_READY",
                        "CLASS_SELECT",
                        null,
                        "Round " + nextRoundSession.roundNumber() + " loadout ready.",
                        resultDelayMillis,
                        playbackStartsAt,
                        resultRevealsAt));
            }
        }
        if (seriesComplete) {
            roundHistoryByMatchId.remove(session.matchId());
        }
        return events;
    }

    private MatchPlaybackDTO withoutResult(MatchPlaybackDTO playback) {
        return new MatchPlaybackDTO(
                playback.matchId(),
                playback.rulesetVersion(),
                playback.status(),
                playback.initialState(),
                playback.frames(),
                null,
                null,
                null);
    }

    private MatchPlaybackDTO resultOnly(MatchPlaybackDTO playback) {
        return new MatchPlaybackDTO(
                playback.matchId(),
                playback.rulesetVersion(),
                playback.status(),
                null,
                List.of(),
                playback.result(),
                playback.winnerUserId(),
                playback.message());
    }

    private MatchPlaybackDTO withWinner(MatchPlaybackDTO playback, UUID winnerUserId, String message) {
        return new MatchPlaybackDTO(playback.matchId(), playback.rulesetVersion(), playback.status(),
                playback.initialState(), playback.frames(), winnerUserId == null ? "DRAW" : "FIGHTER_WIN",
                winnerUserId, message);
    }

    private Map<UUID, Double> roundLossScores(MatchSession session, MatchPlaybackDTO playback) {
        Map<UUID, Double> scores = new HashMap<>();
        session.players().forEach(player -> scores.put(player.userId(), 0.0));
        if (playback.winnerUserId() == null) return Map.copyOf(scores);
        MatchPlayer winner = playerForUser(session, playback.winnerUserId());
        MatchPlayer loser = session.players().stream().filter(player -> !player.userId().equals(winner.userId())).findFirst().orElseThrow();
        if (loser.slot() == 2) {
            int finalCoreHp = playback.frames().isEmpty() ? 250 : playback.frames().get(playback.frames().size() - 1).obstacles().stream()
                    .filter(obstacle -> "core".equals(obstacle.type())).mapToInt(MatchPlaybackDTO.ObstaclePlacementDTO::hp).findFirst().orElse(250);
            scores.put(loser.userId(), Math.max(0.0, Math.min(1.0, (250.0 - finalCoreHp) / 250.0)));
        } else {
            int elapsedMs = playback.frames().isEmpty() ? 0 : playback.frames().get(playback.frames().size() - 1).elapsedMs();
            scores.put(loser.userId(), Math.max(0.0, Math.min(1.0, elapsedMs / 60_000.0)));
        }
        return Map.copyOf(scores);
    }

    private UUID seriesWinner(MatchSession session) {
        MatchPlayer first = session.players().get(0);
        MatchPlayer second = session.players().get(1);
        if (first.roundWins() != second.roundWins()) return first.roundWins() > second.roundWins() ? first.userId() : second.userId();
        Map<UUID, Double> totals = new HashMap<>();
        roundHistoryByMatchId.getOrDefault(session.matchId(), List.of()).forEach(round ->
                round.lossScores().forEach((userId, score) -> totals.merge(userId, score, Double::sum)));
        double firstScore = totals.getOrDefault(first.userId(), 0.0);
        double secondScore = totals.getOrDefault(second.userId(), 0.0);
        if (Math.abs(firstScore - secondScore) < 0.000001) return null;
        return firstScore > secondScore ? first.userId() : second.userId();
    }

    private long resultRevealDelayMillis(MatchPlaybackDTO playback) {
        int finalElapsedMs = playback.frames() == null || playback.frames().isEmpty()
                ? 0
                : playback.frames().get(playback.frames().size() - 1).elapsedMs();
        return Math.max(RESULT_REVEAL_BUFFER_MS, (long) finalElapsedMs + RESULT_REVEAL_BUFFER_MS);
    }

    private List<OutboundMatchmakingEvent> startCountdown(MatchSession session, String type, String message) {
        Instant countdownEndsAt = Instant.now(clock).plusSeconds(COUNTDOWN_SECONDS);
        Instant trainingEndsAt = countdownEndsAt.plusSeconds(TRAINING_SECONDS);
        MatchSession countdownSession = session.withCountdown(countdownEndsAt, trainingEndsAt);
        for (MatchPlayer player : countdownSession.players()) {
            activeSessionsByUserId.put(player.userId(), countdownSession);
            updateParticipantSelectedClass(countdownSession.matchId(), player);
        }
        return countdownSession.players().stream()
                .map(player -> eventForPlayer(
                        countdownSession,
                        player,
                        type,
                        "COUNTDOWN",
                        null,
                        message))
                .toList();
    }

    private List<MatchPlaybackDTO.ObstaclePlacementDTO> normalizeObjectPlacements(
            MatchPlayer player,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> objects) {
        return List.of();
    }

    private List<MatchPlaybackDTO.ObstaclePlacementDTO> combinedObjectPlacements(MatchSession session) {
        return List.of();
    }

    private OutboundMatchmakingEvent waitingEvent(UUID userId, String username, String principalName) {
        return new OutboundMatchmakingEvent(
                principalName,
                new MatchmakingEventDTO(
                        "QUEUE_WAITING",
                        null,
                        null,
                        "WAITING",
                        new MatchmakingPlayerDTO(userId, username, 1, false, 0, "melee", false),
                        null,
                        List.of(),
                        Instant.now(clock),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        null,
                        null,
                        null,
                        null,
                        null,
                        List.of(),
                        List.of(),
                        List.of(),
                        null,
                        List.of(),
                        ROUND_LOGIC_BLOCK_LIMIT));
    }

    private String normalizeSelectedClass(String selectedClass) {
        if (selectedClass != null && selectedClass.matches("custom:[A-Za-z0-9]{0,6}:(?:[0-9]|1[0-2])(?:,(?:[0-9]|1[0-2])){3}")) return selectedClass;
        if ("custom".equals(selectedClass)) return "custom";
        if ("ranged".equals(selectedClass)) return "ranged";
        if ("mage".equals(selectedClass)) return "mage";
        return "melee";
    }

    private String submissionLoadoutId(ModelSubmission submission) {
        if (submission == null || submission.getModelArtifacts() == null) return null;
        try {
            JsonNode loadout = jsonMapper.readTree(submission.getModelArtifacts()).path("loadout");
            if (!loadout.isObject()) return null;
            List<String> selectedCodes = new ArrayList<>();
            loadout.path("abilities").forEach(ability -> {
                String code = ABILITY_CODES.get(ability.asText());
                if (code != null) selectedCodes.add(code);
            });
            selectedCodes.sort(String::compareTo);
            JsonNode stats = loadout.path("statPoints");
            String points = stats.path("maxHp").asInt(0)
                    + "," + stats.path("moveSpeed").asInt(0)
                    + "," + stats.path("attackDamage").asInt(0)
                    + "," + stats.path("attackSpeed").asInt(0);
            return "custom:" + String.join("", selectedCodes) + ":" + points;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void validateRoundLoadoutBudget(String loadout, int roundNumber) {
        if (loadout == null || !loadout.startsWith("custom:")) return;
        String[] parts = loadout.split(":", -1);
        String[] points = parts.length == 3 ? parts[2].split(",", -1) : new String[0];
        int total = 0;
        try {
            for (String point : points) total += Integer.parseInt(point);
        } catch (NumberFormatException ex) {
            throw new AuthException("bot loadout stat points are invalid");
        }
        if (points.length != 4 || total > Math.min(TOTAL_ROUNDS, Math.max(1, roundNumber)) * 4) {
            throw new AuthException("bot loadout exceeds this round's stat point budget");
        }
    }

    private void validateRoundAbilityDraft(MatchSession session, MatchPlayer player, String nextLoadout) {
        if (nextLoadout == null || !nextLoadout.startsWith("custom:")) return;
        int roundNumber = session.roundNumber();
        String nextCodes = nextLoadout.split(":", -1)[1];
        String previousLoadout = player.selectedClass();
        String previousCodes = previousLoadout != null && previousLoadout.startsWith("custom:")
                ? previousLoadout.split(":", -1)[1]
                : "";
        Set<Integer> previous = previousCodes.chars().boxed().collect(java.util.stream.Collectors.toSet());
        Set<Integer> next = nextCodes.chars().boxed().collect(java.util.stream.Collectors.toSet());
        Set<Integer> offered = abilityOffers(session).stream()
                .map(ABILITY_CODES::get)
                .filter(java.util.Objects::nonNull)
                .map(code -> (int) code.charAt(0))
                .collect(java.util.stream.Collectors.toSet());
        Set<Integer> drafted = new java.util.HashSet<>(next);
        drafted.removeAll(previous);
        int requiredPicks = ROUND_PICK_COUNTS.getOrDefault(roundNumber, 0);
        if (!next.containsAll(previous) || drafted.size() != requiredPicks
                || !offered.containsAll(drafted) || next.size() > 6) {
            throw new AuthException("bot loadout must retain prior abilities and choose exactly " + requiredPicks + " abilities from this round's offers");
        }
    }

    private List<String> abilityOffers(MatchSession session) {
        List<String> offers = new ArrayList<>(ROUND_ABILITIES.getOrDefault(session.roundNumber(), List.of()));
        long seed = session.simulationSeed() ^ (0x9E3779B97F4A7C15L * session.roundNumber());
        Collections.shuffle(offers, new Random(seed));
        return List.copyOf(offers.subList(0, Math.min(ROUND_OFFER_COUNTS.getOrDefault(session.roundNumber(), 0), offers.size())));
    }

    private MatchSession withDefaultAbilitySelections(MatchSession session) {
        MatchSession result = session;
        for (MatchPlayer player : session.players()) {
            if (player.classSelected()) continue;
            String current = player.selectedClass() != null && player.selectedClass().startsWith("custom:")
                    ? player.selectedClass() : "custom::0,0,0,0";
            String[] parts = current.split(":", -1);
            String additions = automaticAbilityPicks(session, player).stream()
                    .map(ABILITY_CODES::get)
                    .sorted()
                    .collect(java.util.stream.Collectors.joining());
            String abilities = (parts[1] + additions).chars().sorted()
                    .mapToObj(value -> Character.toString((char) value))
                    .collect(java.util.stream.Collectors.joining());
            result = result.withSelectedClass(player.userId(), "custom:" + abilities + ":" + parts[2], true);
        }
        return result;
    }

    private List<String> automaticAbilityPicks(MatchSession session, MatchPlayer player) {
        List<String> picks = new ArrayList<>(abilityOffers(session));
        long seed = session.simulationSeed() ^ player.userId().getMostSignificantBits()
                ^ player.userId().getLeastSignificantBits() ^ (0xD1B54A32D192ED03L * session.roundNumber());
        Collections.shuffle(picks, new Random(seed));
        return picks.subList(0, Math.min(ROUND_PICK_COUNTS.getOrDefault(session.roundNumber(), 0), picks.size()));
    }

    private Match createMatch(QueuedPlayer firstPlayer, QueuedPlayer secondPlayer) {
        Match match = new Match();
        match.setStatus(MatchStatus.RUNNING);
        match.setRulesetVersion(MatchSimulationService.DUEL_RULESET_VERSION);
        match.setSimulationSeed(ThreadLocalRandom.current().nextLong(1, Long.MAX_VALUE));
        match.setStartedAt(Instant.now(clock));
        return matchRepository.save(match);
    }

    private void createParticipants(Match match, MatchSession session) {
        List<MatchParticipant> participants = session.players().stream()
                .map(player -> {
                    MatchParticipant participant = new MatchParticipant();
                    participant.setMatch(match);
                    participant.setUser(userRepository.getReferenceById(player.userId()));
                    participant.setSlot((short) player.slot());
                    participant.setSelectedClass(player.selectedClass());
                    return participant;
                })
                .toList();
        matchParticipantRepository.saveAll(participants);
    }

    private void updateParticipantSelectedClass(UUID matchId, MatchPlayer player) {
        matchParticipantRepository.findByMatchIdAndUserId(matchId, player.userId())
                .ifPresent(participant -> {
                    participant.setSelectedClass(player.selectedClass());
                    matchParticipantRepository.save(participant);
                });
    }

    private ModelSubmission requireValidatedSubmission(UUID userId, UUID modelSubmissionId, UUID matchId) {
        if (modelSubmissionId == null) {
            throw new AuthException("modelSubmissionId is required before finishing the match");
        }

        ModelSubmission submission = modelSubmissionRepository.findByIdAndUserId(modelSubmissionId, userId)
                .orElseThrow(() -> new AuthException("model submission was not found for this player"));
        if (submission.getStatus() != ModelSubmissionStatus.VALIDATED) {
            throw new AuthException("model submission must be validated before finishing the match");
        }
        if (submission.getMatchId() == null || !submission.getMatchId().equals(matchId)) {
            throw new AuthException("model submission is not assigned to this match");
        }

        return submission;
    }

    private void attachSubmission(UUID matchId, UUID userId, ModelSubmission submission) {
        MatchParticipant participant = matchParticipantRepository.findByMatchIdAndUserId(matchId, userId)
                .orElseThrow(() -> new AuthException("match participant was not found"));
        participant.setModelSubmission(submission);
        participant.setSelectedClass(submission.getSelectedClass());
        matchParticipantRepository.save(participant);
    }

    private Map<UUID, ModelSubmission> loadFinishedSubmissions(MatchSession session) {
        Map<UUID, ModelSubmission> submissions = new HashMap<>();
        for (MatchPlayer player : session.players()) {
            if (player.modelSubmissionId() == null) {
                continue;
            }

            modelSubmissionRepository.findByIdAndUserId(player.modelSubmissionId(), player.userId())
                    .ifPresent(submission -> submissions.put(player.userId(), submission));
        }
        return submissions;
    }

    private void completeMatch(UUID matchId, MatchPlaybackDTO playback) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new AuthException("match was not found"));
        List<MatchParticipant> participants = matchParticipantRepository.findByMatchId(matchId);

        if ("FAILED".equals(playback.status()) || "ERROR".equals(playback.result())) {
            match.setStatus(MatchStatus.FAILED);
        } else {
            match.setStatus(MatchStatus.COMPLETED);
        }
        match.setCompletionReason(COMPLETION_REASON_SIMULATION);
        match.setCompletedAt(Instant.now(clock));

        UUID winnerUserId = playback.winnerUserId();
        if (winnerUserId != null) {
            match.setWinnerUser(userRepository.getReferenceById(winnerUserId));
        }

        for (MatchParticipant participant : participants) {
            if (winnerUserId == null) {
                participant.setResult(MatchResult.DRAW);
            } else if (participant.getUser().getId().equals(winnerUserId)) {
                participant.setResult(MatchResult.WIN);
            } else {
                participant.setResult(MatchResult.LOSS);
            }
            incrementMatchesPlayed(participant.getUser());
        }

        matchRepository.save(match);
        matchParticipantRepository.saveAll(participants);
    }

    private void completeMatchByResignation(UUID matchId, MatchPlayer resigningPlayer, MatchPlayer winner) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new AuthException("match was not found"));
        List<MatchParticipant> participants = matchParticipantRepository.findByMatchId(matchId);

        match.setStatus(MatchStatus.COMPLETED);
        match.setCompletionReason(COMPLETION_REASON_RESIGNATION);
        match.setCompletedAt(Instant.now(clock));
        match.setWinnerUser(userRepository.getReferenceById(winner.userId()));

        for (MatchParticipant participant : participants) {
            if (participant.getUser().getId().equals(resigningPlayer.userId())) {
                participant.setResult(MatchResult.FORFEIT);
            } else if (participant.getUser().getId().equals(winner.userId())) {
                participant.setResult(MatchResult.WIN);
            }
            incrementMatchesPlayed(participant.getUser());
        }

        matchRepository.save(match);
        matchParticipantRepository.saveAll(participants);
    }

    private void incrementMatchesPlayed(AppUser user) {
        Profile profile = profileRepository.findByUserId(user.getId())
                .orElseGet(() -> {
                    Profile created = new Profile();
                    created.setUser(userRepository.getReferenceById(user.getId()));
                    return created;
                });
        profile.setMatchesPlayed(profile.getMatchesPlayed() + 1);
        profileRepository.save(profile);
    }

    private void validateRoundBrainPolicy(MatchSession session, UUID userId, ModelSubmission submission) {
        JsonNode currentBrain = readSubmissionBrain(submission);
        Map<String, String> currentBlocks = blockFingerprints(currentBrain);
        List<RoundSubmissionRecord> history = roundHistoryByMatchId.getOrDefault(session.matchId(), List.of());
        if (history.isEmpty()) {
            if (currentBlocks.size() > ROUND_LOGIC_BLOCK_LIMIT) {
                throw new AuthException("round 1 exceeds the per-round logic block limit");
            }
            return;
        }

        if (session.roundNumber() == 3) {
            if (currentBlocks.size() > ROUND_LOGIC_BLOCK_LIMIT) {
                throw new AuthException("round 3 exceeds the per-round logic block limit");
            }
            return;
        }

        Map<Integer, Map<String, String>> blocksByRound = new HashMap<>();
        Map<String, Integer> introducedRoundById = new HashMap<>();
        for (RoundSubmissionRecord round : history) {
            ModelSubmission historicalSubmission = round.submissionsByUser().get(userId);
            if (historicalSubmission == null) continue;
            Map<String, String> blocks = blockFingerprints(readSubmissionBrain(historicalSubmission));
            blocksByRound.put(round.roundNumber(), blocks);
            blocks.keySet().forEach(id -> introducedRoundById.putIfAbsent(id, round.roundNumber()));
        }

        RoundSubmissionRecord previousRound = history.get(history.size() - 1);
        Map<String, String> previousBlocks = blocksByRound.getOrDefault(previousRound.roundNumber(), Map.of());
        boolean previousWinner = userId.equals(previousRound.winnerUserId());

        long newBlockCount = currentBlocks.keySet().stream()
                .filter(id -> !introducedRoundById.containsKey(id))
                .count();
        if (newBlockCount > ROUND_LOGIC_BLOCK_LIMIT) {
            throw new AuthException("current round exceeds the per-round logic block limit");
        }

        for (Map.Entry<String, Integer> introduced : introducedRoundById.entrySet()) {
            String id = introduced.getKey();
            boolean currentlyPresent = currentBlocks.containsKey(id);
            boolean presentLastRound = previousBlocks.containsKey(id);
            if (!presentLastRound && currentlyPresent) {
                throw new AuthException("a deleted prior-round logic block cannot be reintroduced");
            }
            if (introduced.getValue() <= session.roundNumber() - 2) {
                if (presentLastRound
                        && (!currentlyPresent || !currentBlocks.get(id).equals(previousBlocks.get(id)))) {
                    throw new AuthException("logic blocks from two or more rounds ago are locked");
                }
            } else if (presentLastRound && currentlyPresent
                    && !currentBlocks.get(id).equals(previousBlocks.get(id))) {
                throw new AuthException("previous-round logic blocks may only be deleted");
            }
        }
    }

    private List<RoundBrainDTO> roundBrainsForPlayer(UUID matchId, UUID userId) {
        return roundHistoryByMatchId.getOrDefault(matchId, List.of()).stream()
                .map(round -> {
                    ModelSubmission submission = round.submissionsByUser().get(userId);
                    if (submission == null) return null;
                    return new RoundBrainDTO(
                            round.roundNumber(),
                            readSubmissionBrain(submission),
                            userId.equals(round.winnerUserId()));
                })
                .filter(round -> round != null)
                .toList();
    }

    private Boolean previousRoundWon(UUID matchId, UUID userId) {
        List<RoundSubmissionRecord> history = roundHistoryByMatchId.getOrDefault(matchId, List.of());
        if (history.isEmpty()) return null;
        return userId.equals(history.get(history.size() - 1).winnerUserId());
    }

    private JsonNode readSubmissionBrain(ModelSubmission submission) {
        try {
            return jsonMapper.readTree(submission.getModelArtifacts());
        } catch (Exception exception) {
            throw new AuthException("submitted brain could not be read");
        }
    }

    private Map<String, String> blockFingerprints(JsonNode brain) {
        Map<String, String> fingerprints = new HashMap<>();
        JsonNode columns = brain != null ? brain.get("columns") : null;
        if (columns != null && columns.isArray()) {
            columns.forEach(column -> addTreeFingerprints(
                    fingerprints,
                    column.get("branches"),
                    "column:" + fieldText(column, "id") + ":" + fieldText(column, "createdOrder")));
            return fingerprints;
        }
        JsonNode blocks = brain != null ? brain.get("blocks") : null;
        if (blocks != null && blocks.isArray()) {
            blocks.forEach(block -> addBlockFingerprint(fingerprints, block, "root"));
        }
        JsonNode clusters = brain != null ? brain.get("clusters") : null;
        if (clusters != null && clusters.isArray()) {
            clusters.forEach(cluster -> {
                String context = "cluster:"
                        + fieldText(cluster, "id") + ":"
                        + fieldText(cluster, "priority") + ":"
                        + String.valueOf(cluster.get("conditions"));
                JsonNode clusterBlocks = cluster.get("blocks");
                if (clusterBlocks != null && clusterBlocks.isArray()) {
                    clusterBlocks.forEach(block -> addBlockFingerprint(fingerprints, block, context));
                }
            });
        }
        return fingerprints;
    }

    private void addTreeFingerprints(Map<String, String> fingerprints, JsonNode branches, String context) {
        if (branches == null || !branches.isArray()) return;
        branches.forEach(branch -> {
            String branchContext = context + ":" + fieldText(branch, "branchType") + ":" + fieldText(branch, "createdOrder");
            addBlockFingerprint(fingerprints, branch, branchContext);
            addTreeFingerprints(fingerprints, branch.get("children"), branchContext + ":" + fieldText(branch, "id"));
        });
    }

    private void addBlockFingerprint(Map<String, String> fingerprints, JsonNode block, String context) {
        String id = fieldText(block, "id");
        if (id.isBlank() || fingerprints.putIfAbsent(id, context + ":" + block) != null) {
            throw new AuthException("logic block IDs must be present and unique across rounds");
        }
    }

    private static String fieldText(JsonNode node, String field) {
        JsonNode value = node != null ? node.get(field) : null;
        return value != null ? value.asText() : "";
    }

    private OutboundMatchmakingEvent eventForPlayer(MatchSession session, MatchPlayer player, String type) {
        String status = session.countdownEndsAt() != null
                ? "COUNTDOWN"
                : session.objectPlacementEndsAt() != null ? "OBJECT_PLACEMENT" : "CLASS_SELECT";
        return eventForPlayer(session, player, type, status, null, null);
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message) {
        return eventForPlayer(session, player, type, status, playback, message, null, List.of());
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            UUID objectPlacementUserId,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> objectPlacements) {
        return eventForPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                objectPlacementUserId,
                objectPlacements,
                0);
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            long delayMillis) {
        return eventForPlayer(session, player, type, status, playback, message, null, List.of(), delayMillis);
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            UUID objectPlacementUserId,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> objectPlacements,
            long delayMillis) {
        return eventForPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                objectPlacementUserId,
                objectPlacements,
                delayMillis,
                null,
                null);
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt) {
        return eventForPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                null,
                List.of(),
                delayMillis,
                playbackStartsAt,
                resultRevealsAt);
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            UUID objectPlacementUserId,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> objectPlacements,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt) {
        MatchPlayer opponent = session.players().stream()
                .filter(candidate -> !candidate.userId().equals(player.userId()))
                .findFirst()
                .orElse(null);
        return new OutboundMatchmakingEvent(
                player.principalName(),
                new MatchmakingEventDTO(
                        type,
                        session.matchId(),
                        session.simulationSeed(),
                        status,
                        player.toDto(session.objectPlacementsByUserId().containsKey(player.userId())),
                        opponent == null ? null : opponent.toDto(session.objectPlacementsByUserId().containsKey(opponent.userId())),
                        session.players().stream()
                                .map(matchPlayer -> matchPlayer.toDto(
                                        session.objectPlacementsByUserId().containsKey(matchPlayer.userId())))
                                .toList(),
                        Instant.now(clock),
                        session.classSelectionEndsAt(),
                        session.objectPlacementEndsAt(),
                        session.countdownEndsAt(),
                        session.trainingEndsAt(),
                        playbackStartsAt,
                        resultRevealsAt,
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        playback,
                        session.roundNumber(),
                        session.winsRequired(),
                        message,
                        objectPlacementUserId,
                        objectPlacements != null ? List.copyOf(objectPlacements) : List.of(),
                        session.obstacles(),
                        roundBrainsForPlayer(session.matchId(), player.userId()),
                        previousRoundWon(session.matchId(), player.userId()),
                        abilityOffers(session),
                        ROUND_LOGIC_BLOCK_LIMIT),
                delayMillis);
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }

    private record QueuedPlayer(UUID userId, String username, String principalName) {
    }

    private record RoundSubmissionRecord(
            int roundNumber,
            UUID winnerUserId,
            Map<UUID, ModelSubmission> submissionsByUser,
            Map<UUID, Double> lossScores) {
    }

    public record MatchPlayer(
            UUID userId,
            String username,
            String principalName,
            int slot,
            boolean finished,
            UUID modelSubmissionId,
            int roundWins,
            String selectedClass,
            boolean classSelected) {
        MatchmakingPlayerDTO toDto() {
            return toDto(false);
        }

        MatchmakingPlayerDTO toDto(boolean objectPlacementSubmitted) {
            return new MatchmakingPlayerDTO(
                    userId,
                    username,
                    slot,
                    finished,
                    roundWins,
                    selectedClass,
                    classSelected,
                    objectPlacementSubmitted);
        }
    }

    public record MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant classSelectionEndsAt,
            Instant objectPlacementEndsAt,
            Instant countdownEndsAt,
            Instant trainingEndsAt,
            int roundNumber,
            int winsRequired,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles,
            Map<UUID, List<MatchPlaybackDTO.ObstaclePlacementDTO>> objectPlacementsByUserId) {
        MatchSession withObstacles(List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players,
                    classSelectionEndsAt,
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles != null ? List.copyOf(obstacles) : List.of(),
                    objectPlacementsByUserId);
        }

        MatchSession withFinishedPlayer(UUID userId, UUID modelSubmissionId) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players.stream()
                            .map(player -> player.userId().equals(userId)
                                    ? new MatchPlayer(
                                            player.userId(),
                                            player.username(),
                                            player.principalName(),
                                            player.slot(),
                                            true,
                                            modelSubmissionId,
                                            player.roundWins(),
                                            player.selectedClass(),
                                            player.classSelected())
                    : player)
                            .toList(),
                    classSelectionEndsAt,
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId);
        }

        MatchSession withRoundResult(UUID winnerUserId) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players.stream()
                            .map(player -> player.userId().equals(winnerUserId)
                                    ? new MatchPlayer(
                                            player.userId(),
                                            player.username(),
                                            player.principalName(),
                                            player.slot(),
                                            player.finished(),
                                            player.modelSubmissionId(),
                                            player.roundWins() + 1,
                                            player.selectedClass(),
                                            player.classSelected())
                    : player)
                            .toList(),
                    classSelectionEndsAt,
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId);
        }

        MatchSession nextRound() {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players.stream()
                            .map(player -> new MatchPlayer(
                                    player.userId(),
                                    player.username(),
                                    player.principalName(),
                                    player.slot(),
                                    false,
                                    null,
                                    player.roundWins(),
                                    player.selectedClass(),
                                    false))
                            .toList(),
                    classSelectionEndsAt,
                    null,
                    null,
                    null,
                    roundNumber + 1,
                    winsRequired,
                    List.of(),
                    Map.of());
        }

        MatchSession withClassSelection(Instant deadline) {
            return new MatchSession(matchId, simulationSeed, players, deadline, null, null, null,
                    roundNumber, winsRequired, List.of(), Map.of());
        }

        MatchSession withSelectedClass(UUID userId, String selectedClass, boolean classSelected) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players.stream()
                            .map(player -> player.userId().equals(userId)
                                    ? new MatchPlayer(
                                            player.userId(),
                                            player.username(),
                                            player.principalName(),
                                            player.slot(),
                                            player.finished(),
                                            player.modelSubmissionId(),
                                            player.roundWins(),
                                            selectedClass,
                                            classSelected)
                    : player)
                            .toList(),
                    classSelectionEndsAt,
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId);
        }

        MatchSession withDefaultClassSelections() {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players.stream()
                            .map(player -> new MatchPlayer(
                                    player.userId(),
                                    player.username(),
                                    player.principalName(),
                                    player.slot(),
                                    player.finished(),
                                    player.modelSubmissionId(),
                                    player.roundWins(),
                                    player.selectedClass() != null ? player.selectedClass() : "custom::0,0,0,0",
                                    true))
                            .toList(),
                    classSelectionEndsAt,
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId);
        }

        MatchSession withObjectPlacement(Instant nextObjectPlacementEndsAt) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players,
                    classSelectionEndsAt,
                    nextObjectPlacementEndsAt,
                    null,
                    null,
                    roundNumber,
                    winsRequired,
                    List.of(),
                    Map.of());
        }

        MatchSession withObjectPlacements(UUID userId, List<MatchPlaybackDTO.ObstaclePlacementDTO> objects) {
            Map<UUID, List<MatchPlaybackDTO.ObstaclePlacementDTO>> placements = new HashMap<>(objectPlacementsByUserId);
            placements.put(userId, List.copyOf(objects != null ? objects : List.of()));
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players,
                    classSelectionEndsAt,
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    Map.copyOf(placements));
        }

        MatchSession withCountdown(Instant nextCountdownEndsAt, Instant nextTrainingEndsAt) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players.stream()
                            .map(player -> new MatchPlayer(
                                    player.userId(),
                                    player.username(),
                                    player.principalName(),
                                    player.slot(),
                                    player.finished(),
                                    player.modelSubmissionId(),
                                    player.roundWins(),
                                    player.selectedClass() != null ? player.selectedClass() : "melee",
                                    true))
                            .toList(),
                    classSelectionEndsAt,
                    null,
                    nextCountdownEndsAt,
                    nextTrainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId);
        }
    }

    public record OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event, long delayMillis) {
        public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event) {
            this(principalName, event, 0);
        }
    }
}

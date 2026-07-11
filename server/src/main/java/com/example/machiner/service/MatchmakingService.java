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
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MatchmakingService {

    private static final int COUNTDOWN_SECONDS = 5;
    private static final int CLASS_SELECTION_SECONDS = 30;
    private static final int OBJECT_PLACEMENT_SECONDS = 20;
    private static final int TRAINING_SECONDS = 600;
    private static final int OBJECT_PLACEMENT_LIMIT = 3;
    private static final int MAX_MATCH_OBJECTS = 6;
    private static final int BUFF_PICKUP_SIZE = 76;
    private static final int RESULT_REVEAL_BUFFER_MS = 250;
    private static final int WINS_REQUIRED = 2;
    private static final int ROUND_LOGIC_BLOCK_LIMIT = 10;
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
        List<MatchPlayer> players = List.of(
                new MatchPlayer(
                        opponent.userId(),
                        opponent.username(),
                        opponent.principalName(),
                        1,
                        false,
                        null,
                        0,
                        "melee",
                        false),
                new MatchPlayer(
                        player.userId(),
                        player.username(),
                        player.principalName(),
                        2,
                        false,
                        null,
                        0,
                        "melee",
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

        MatchSession selectedSession = session.withSelectedClass(userId, normalizeSelectedClass(selectedClass), true);
        if (selectedSession.players().stream().allMatch(MatchPlayer::classSelected)) {
            return startObjectPlacement(selectedSession, "MATCH_OBJECT_PLACEMENT_READY", "Both classes locked.");
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
                        playerForUser(selectedSession, userId).username() + " locked a class."))
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
        return startObjectPlacement(session.withDefaultClassSelections(), "MATCH_OBJECT_PLACEMENT_READY", "Class selection ended.");
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
        validateRoundBrainPolicy(session, userId, submission);
        MatchPlayer submittingPlayer = playerForUser(session, userId);
        String submissionClass = normalizeSelectedClass(submission.getSelectedClass());
        if (!submissionClass.equals(submittingPlayer.selectedClass())) {
            throw new AuthException("model submission class does not match the selected match class");
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
                        Map.copyOf(submissionsByUserId)));
        boolean seriesComplete = playback.winnerUserId() != null
                && playerForUser(scoredSession, playback.winnerUserId()).roundWins() >= scoredSession.winsRequired();
        if (seriesComplete) {
            completeMatch(scoredSession.matchId(), playback);

            for (MatchPlayer player : scoredSession.players()) {
                activeSessionsByUserId.remove(player.userId());
            }
        }
        MatchPlaybackDTO replayOnlyPlayback = withoutResult(playback);
        MatchPlaybackDTO resultOnlyPlayback = resultOnly(playback);
        long resultDelayMillis = resultRevealDelayMillis(playback);
        Instant playbackStartsAt = Instant.now(clock);
        Instant resultRevealsAt = playbackStartsAt.plusMillis(resultDelayMillis);
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
            Instant nextCountdownEndsAt = resultRevealsAt.plusSeconds(COUNTDOWN_SECONDS);
            Instant nextTrainingEndsAt = nextCountdownEndsAt.plusSeconds(TRAINING_SECONDS);
            MatchSession nextRoundSession = scoredSession.nextRound();
            nextRoundSession = nextRoundSession.withCountdown(nextCountdownEndsAt, nextTrainingEndsAt);
            for (MatchPlayer player : nextRoundSession.players()) {
                activeSessionsByUserId.put(player.userId(), nextRoundSession);
                events.add(eventForPlayer(
                        nextRoundSession,
                        player,
                        "MATCH_ROUND_READY",
                        "COUNTDOWN",
                        null,
                        "Round " + nextRoundSession.roundNumber() + " ready.",
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

    private long resultRevealDelayMillis(MatchPlaybackDTO playback) {
        int finalElapsedMs = playback.frames() == null || playback.frames().isEmpty()
                ? 0
                : playback.frames().get(playback.frames().size() - 1).elapsedMs();
        return Math.max(RESULT_REVEAL_BUFFER_MS, (long) finalElapsedMs + RESULT_REVEAL_BUFFER_MS);
    }

    private List<OutboundMatchmakingEvent> startObjectPlacement(MatchSession session, String type, String message) {
        Instant objectPlacementEndsAt = Instant.now(clock).plusSeconds(OBJECT_PLACEMENT_SECONDS);
        MatchSession timedPlacementSession = session.withObjectPlacement(objectPlacementEndsAt);
        MatchSession placementSession = timedPlacementSession.withObstacles(
                matchSimulationService.buildMatchObstacles(timedPlacementSession));
        for (MatchPlayer player : placementSession.players()) {
            activeSessionsByUserId.put(player.userId(), placementSession);
            updateParticipantSelectedClass(placementSession.matchId(), player);
        }
        return placementSession.players().stream()
                .map(player -> eventForPlayer(
                        placementSession,
                        player,
                        type,
                        "OBJECT_PLACEMENT",
                        null,
                        message))
                .toList();
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
        if (objects == null) return List.of();
        return objects.stream()
                .filter(object -> object != null && isPlaceableObjectType(object.type()))
                .limit(OBJECT_PLACEMENT_LIMIT)
                .map(object -> normalizeObjectPlacement(player, object))
                .toList();
    }

    private MatchPlaybackDTO.ObstaclePlacementDTO normalizeObjectPlacement(
            MatchPlayer player,
            MatchPlaybackDTO.ObstaclePlacementDTO object) {
        String type = object.type();
        int defaultSize = "healthPack".equals(type) ? 42 : isBuffPickupType(type) ? BUFF_PICKUP_SIZE : 120;
        int size = (int) Math.max(16, Math.min(240, object.size() > 0 ? object.size() : defaultSize));
        double radius = size / 2.0;
        double minY = player.slot() == 1 ? radius : 800.0 * 2.0 / 3.0 + radius;
        double maxY = player.slot() == 1 ? 800.0 / 3.0 - radius : 800.0 - radius;
        return new MatchPlaybackDTO.ObstaclePlacementDTO(
                object.id(),
                type,
                clamp(object.x(), radius, 800.0 - radius),
                clamp(object.y(), minY, Math.max(minY, maxY)),
                size,
                isWallType(type) ? snapWallRotation(object.rotation()) : 0.0);
    }

    private List<MatchPlaybackDTO.ObstaclePlacementDTO> combinedObjectPlacements(MatchSession session) {
        List<MatchPlaybackDTO.ObstaclePlacementDTO> matchObjects = session.obstacles() == null
                ? List.of()
                : session.obstacles();
        List<MatchPlaybackDTO.ObstaclePlacementDTO> orderedObjects = session.players().stream()
                .flatMap(player -> session.objectPlacementsByUserId()
                        .getOrDefault(player.userId(), List.of())
                        .stream())
                .limit(MAX_MATCH_OBJECTS)
                .toList();
        List<MatchPlaybackDTO.ObstaclePlacementDTO> labeledObjects = new ArrayList<>(
                matchObjects != null ? matchObjects : List.of());
        for (int index = 0; index < orderedObjects.size(); index += 1) {
            MatchPlaybackDTO.ObstaclePlacementDTO object = orderedObjects.get(index);
            labeledObjects.add(new MatchPlaybackDTO.ObstaclePlacementDTO(
                    "object_" + (index + 1),
                    object.type(),
                    object.x(),
                    object.y(),
                    object.size(),
                    object.rotation(),
                    object.hp()));
        }
        return labeledObjects;
    }

    private boolean isPlaceableObjectType(String type) {
        return "healthPack".equals(type)
                || "projectileWall".equals(type)
                || "bouncyWall".equals(type);
    }

    private boolean isWallType(String type) {
        return "projectileWall".equals(type) || "bouncyWall".equals(type);
    }

    private boolean isBuffPickupType(String type) {
        return "overdrive".equals(type) || "barrier".equals(type) || "inhibition".equals(type);
    }

    private double snapWallRotation(double rotation) {
        return ((Math.round(rotation / 45.0) * 45.0) % 360.0 + 360.0) % 360.0;
    }

    private double clamp(double value, double min, double max) {
        if (!Double.isFinite(value)) return min;
        return Math.max(min, Math.min(max, value));
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
                        ROUND_LOGIC_BLOCK_LIMIT));
    }

    private String normalizeSelectedClass(String selectedClass) {
        if ("ranged".equals(selectedClass)) return "ranged";
        if ("mage".equals(selectedClass)) return "mage";
        return "melee";
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
            } else if (previousWinner && presentLastRound && currentlyPresent
                    && !currentBlocks.get(id).equals(previousBlocks.get(id))) {
                throw new AuthException("the previous round winner may only delete prior-round logic blocks");
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
            Map<UUID, ModelSubmission> submissionsByUser) {
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
                                    player.classSelected()))
                            .toList(),
                    classSelectionEndsAt,
                    null,
                    null,
                    null,
                    roundNumber + 1,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId);
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
                                    player.selectedClass() != null ? player.selectedClass() : "melee",
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

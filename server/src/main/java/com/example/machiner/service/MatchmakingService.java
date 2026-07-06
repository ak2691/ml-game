package com.example.machiner.service;

import com.example.machiner.DTO.MatchPlaybackDTO;
import com.example.machiner.DTO.MatchmakingEventDTO;
import com.example.machiner.DTO.MatchmakingPlayerDTO;
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

@Service
public class MatchmakingService {

    private static final int COUNTDOWN_SECONDS = 5;
    private static final int CLASS_SELECTION_SECONDS = 30;
    private static final int TRAINING_SECONDS = 600;
    private static final int RESULT_REVEAL_BUFFER_MS = 250;
    private static final int WINS_REQUIRED = 2;
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
                1,
                WINS_REQUIRED,
                List.of());
        MatchSession session = pendingSession.withObstacles(matchSimulationService.buildMatchObstacles(pendingSession));
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
            return startCountdown(selectedSession, "MATCH_COUNTDOWN_READY", "Both classes locked.");
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
        return startCountdown(session.withDefaultClassSelections(), "MATCH_COUNTDOWN_READY", "Class selection ended.");
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
            MatchSession nextRoundSession = scoredSession.nextRound(
                    nextCountdownEndsAt,
                    nextTrainingEndsAt);
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
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        null,
                        null,
                        null,
                        null,
                        null));
    }

    private String normalizeSelectedClass(String selectedClass) {
        return "ranged".equals(selectedClass) ? "ranged" : "melee";
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

    private OutboundMatchmakingEvent eventForPlayer(MatchSession session, MatchPlayer player, String type) {
        return eventForPlayer(session, player, type, session.countdownEndsAt() == null ? "CLASS_SELECT" : "COUNTDOWN", null, null);
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message) {
        return eventForPlayer(session, player, type, status, playback, message, 0);
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            long delayMillis) {
        return eventForPlayer(session, player, type, status, playback, message, delayMillis, null, null);
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
                        player.toDto(),
                        opponent == null ? null : opponent.toDto(),
                        session.players().stream().map(MatchPlayer::toDto).toList(),
                        Instant.now(clock),
                        session.classSelectionEndsAt(),
                        session.countdownEndsAt(),
                        session.trainingEndsAt(),
                        playbackStartsAt,
                        resultRevealsAt,
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        playback,
                        session.roundNumber(),
                        session.winsRequired(),
                        message,
                        session.obstacles()),
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
            return new MatchmakingPlayerDTO(userId, username, slot, finished, roundWins, selectedClass, classSelected);
        }
    }

    public record MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant classSelectionEndsAt,
            Instant countdownEndsAt,
            Instant trainingEndsAt,
            int roundNumber,
            int winsRequired,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles) {
        MatchSession withObstacles(List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players,
                    classSelectionEndsAt,
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles != null ? List.copyOf(obstacles) : List.of());
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
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles);
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
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles);
        }

        MatchSession nextRound(Instant nextCountdownEndsAt, Instant nextTrainingEndsAt) {
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
                    nextCountdownEndsAt,
                    nextTrainingEndsAt,
                    roundNumber + 1,
                    winsRequired,
                    obstacles);
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
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles);
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
                    countdownEndsAt,
                    trainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles);
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
                    nextCountdownEndsAt,
                    nextTrainingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles);
        }
    }

    public record OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event, long delayMillis) {
        public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event) {
            this(principalName, event, 0);
        }
    }
}

package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.machiner.DTO.MatchPlaybackDTO;
import com.example.machiner.DTO.MatchmakingEventDTO;
import com.example.machiner.domain.AppUser;
import com.example.machiner.domain.Match;
import com.example.machiner.domain.MatchParticipant;
import com.example.machiner.domain.MatchResult;
import com.example.machiner.domain.MatchStatus;
import com.example.machiner.domain.ModelSubmission;
import com.example.machiner.domain.ModelSubmissionStatus;
import com.example.machiner.repository.MatchParticipantRepository;
import com.example.machiner.repository.MatchRepository;
import com.example.machiner.repository.ModelSubmissionRepository;
import com.example.machiner.repository.ProfileRepository;
import com.example.machiner.repository.UserRepository;
import com.example.machiner.service.MatchmakingService.MatchSession;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class MatchmakingServiceTest {

    private final MatchSimulationService simulationService = mock(MatchSimulationService.class);
    private final MatchRepository matchRepository = mock(MatchRepository.class);
    private final MatchParticipantRepository matchParticipantRepository = mock(MatchParticipantRepository.class);
    private final ModelSubmissionRepository modelSubmissionRepository = mock(ModelSubmissionRepository.class);
    private final ModelFingerprintProbeService modelFingerprintProbeService = mock(ModelFingerprintProbeService.class);
    private final ProfileRepository profileRepository = mock(ProfileRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final Clock clock = Clock.fixed(Instant.parse("2026-06-03T12:00:00Z"), ZoneOffset.UTC);
    private final List<MatchParticipant> participants = new ArrayList<>();

    private Match savedMatch;
    private MatchmakingService service;

    @BeforeEach
    void setUp() {
        service = new MatchmakingService(
                simulationService,
                matchRepository,
                matchParticipantRepository,
                modelSubmissionRepository,
                modelFingerprintProbeService,
                profileRepository,
                userRepository,
                clock);
        when(modelFingerprintProbeService.scheduleProbes(any(), any(), any(), any())).thenReturn(List.of());

        when(matchRepository.save(any(Match.class))).thenAnswer(invocation -> {
            savedMatch = invocation.getArgument(0);
            if (savedMatch.getId() == null) {
                savedMatch.setId(UUID.randomUUID());
            }
            return savedMatch;
        });
        when(matchRepository.findById(any(UUID.class))).thenAnswer(invocation ->
                Optional.ofNullable(savedMatch));
        when(userRepository.getReferenceById(any(UUID.class))).thenAnswer(invocation -> user(invocation.getArgument(0)));
        when(matchParticipantRepository.saveAll(any())).thenAnswer(invocation -> {
            Iterable<MatchParticipant> saved = invocation.getArgument(0);
            List<MatchParticipant> copy = new ArrayList<>();
            saved.forEach(copy::add);
            participants.clear();
            participants.addAll(copy);
            return participants;
        });
        when(matchParticipantRepository.save(any(MatchParticipant.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(matchParticipantRepository.findByMatchId(any(UUID.class))).thenReturn(participants);
        when(matchParticipantRepository.findByMatchIdAndUserId(any(UUID.class), any(UUID.class))).thenAnswer(invocation -> {
            UUID userId = invocation.getArgument(1);
            return participants.stream()
                    .filter(participant -> participant.getUser().getId().equals(userId))
                    .findFirst();
        });
        when(profileRepository.findByUserId(any(UUID.class))).thenReturn(Optional.empty());
        when(simulationService.buildDuelPlayback(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            MatchmakingService.MatchPlayer winner = session.players().stream()
                    .filter(player -> player.slot() == 2)
                    .findFirst()
                    .orElseThrow();
            return new MatchPlaybackDTO(
                    session.matchId(),
                    MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED",
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of()),
                    List.of(),
                    "FIGHTER_WIN",
                    winner.userId(),
                    winner.username() + " wins the fight.");
        });
    }

    @Test
    void firstQueuedPlayerWaitsForOpponent() {
        UUID firstUserId = UUID.randomUUID();

        List<MatchmakingService.OutboundMatchmakingEvent> events =
                service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");

        assertThat(events).hasSize(1);
        MatchmakingEventDTO event = events.get(0).event();
        assertThat(events.get(0).principalName()).isEqualTo("pilot-one@example.com");
        assertThat(event.type()).isEqualTo("QUEUE_WAITING");
        assertThat(event.status()).isEqualTo("WAITING");
        assertThat(event.player().userId()).isEqualTo(firstUserId);
    }

    @Test
    void secondQueuedPlayerCreatesMatchFoundEventsForBothPlayers() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");

        List<MatchmakingService.OutboundMatchmakingEvent> events =
                service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        assertThat(events).hasSize(2);
        assertThat(events).extracting(MatchmakingService.OutboundMatchmakingEvent::principalName)
                .containsExactlyInAnyOrder("pilot-one@example.com", "pilot-two@example.com");
        assertThat(events).allSatisfy(outbound -> {
            MatchmakingEventDTO event = outbound.event();
            assertThat(event.type()).isEqualTo("MATCH_FOUND");
            assertThat(event.status()).isEqualTo("COUNTDOWN");
            assertThat(event.matchId()).isNotNull();
            assertThat(event.players()).hasSize(2);
            assertThat(event.players()).extracting("slot").containsExactlyInAnyOrder(1, 2);
            assertThat(event.opponent()).isNotNull();
            assertThat(event.countdownEndsAt()).isNotNull();
            assertThat(event.trainingEndsAt()).isNotNull();
            assertThat(event.trainingEndsAt()).isEqualTo(event.countdownEndsAt().plusSeconds(600));
            assertThat(event.rulesetVersion()).isEqualTo("duel-v1");
        });
        assertThat(participants).hasSize(2);
    }

    @Test
    void sameUserCannotOccupyBothMatchSlots() {
        UUID userId = UUID.randomUUID();
        service.joinQueue(userId, "pilot-one", "pilot-one@example.com");

        List<MatchmakingService.OutboundMatchmakingEvent> events =
                service.joinQueue(userId, "pilot-one", "pilot-one@example.com");

        assertThat(events).hasSize(1);
        assertThat(events.get(0).event().type()).isEqualTo("QUEUE_WAITING");
    }

    @Test
    void firstRoundWinProducesPlaybackAndNextRoundEvents() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);

        List<MatchmakingService.OutboundMatchmakingEvent> firstFinishEvents =
                service.markFinished(firstUserId, firstSubmissionId);
        assertThat(firstFinishEvents).hasSize(2);
        assertThat(firstFinishEvents).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("PLAYER_FINISHED");
            assertThat(outbound.event().status()).isEqualTo("WAITING_FOR_FINISH");
            assertThat(outbound.event().playback()).isNull();
        });

        List<MatchmakingService.OutboundMatchmakingEvent> secondFinishEvents =
                service.markFinished(secondUserId, secondSubmissionId);
        assertThat(secondFinishEvents).hasSize(6);
        assertThat(secondFinishEvents)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_PLAYBACK_READY"))
                .hasSize(2)
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().status()).isEqualTo("READY_FOR_PLAYBACK");
                    assertThat(outbound.event().playback()).isNotNull();
                    assertThat(outbound.event().playback().result()).isNull();
                    assertThat(outbound.delayMillis()).isZero();
                });
        assertThat(secondFinishEvents)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_RESULT_READY"))
                .hasSize(2)
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().status()).isEqualTo("RESULT_READY");
                    assertThat(outbound.event().playback()).isNotNull();
                    assertThat(outbound.event().playback().frames()).isEmpty();
                    assertThat(outbound.event().playback().result()).isEqualTo("FIGHTER_WIN");
                    assertThat(outbound.delayMillis()).isPositive();
                });
        assertThat(secondFinishEvents)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .hasSize(2)
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().status()).isEqualTo("COUNTDOWN");
                    assertThat(outbound.event().roundNumber()).isEqualTo(2);
                    assertThat(outbound.event().winsRequired()).isEqualTo(2);
                    assertThat(outbound.event().player().finished()).isFalse();
                    assertThat(outbound.event().players()).extracting("roundWins").containsExactlyInAnyOrder(0, 1);
                    assertThat(outbound.delayMillis()).isPositive();
                });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.RUNNING);
    }

    @Test
    void secondRoundWinCompletesBestOfThreeMatch() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        UUID firstRoundFirstSubmission = UUID.randomUUID();
        UUID firstRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, firstRoundFirstSubmission);
        stubSubmission(secondUserId, firstRoundSecondSubmission);
        service.markFinished(firstUserId, firstRoundFirstSubmission);
        service.markFinished(secondUserId, firstRoundSecondSubmission);

        UUID secondRoundFirstSubmission = UUID.randomUUID();
        UUID secondRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, secondRoundFirstSubmission);
        stubSubmission(secondUserId, secondRoundSecondSubmission);
        service.markFinished(firstUserId, secondRoundFirstSubmission);
        List<MatchmakingService.OutboundMatchmakingEvent> finalEvents =
                service.markFinished(secondUserId, secondRoundSecondSubmission);

        assertThat(finalEvents)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .isEmpty();
        assertThat(finalEvents)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_RESULT_READY"))
                .hasSize(2)
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().roundNumber()).isEqualTo(2);
                    assertThat(outbound.event().players()).extracting("roundWins").containsExactlyInAnyOrder(0, 2);
                    assertThat(outbound.event().playback().winnerUserId()).isEqualTo(secondUserId);
                });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
    }

    @Test
    void surrenderCompletesMatchAsResignationWinForOpponent() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        List<MatchmakingService.OutboundMatchmakingEvent> events = service.surrender(firstUserId);

        assertThat(events).hasSize(2);
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("RESIGNATION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
        assertThat(participants)
                .filteredOn(participant -> participant.getUser().getId().equals(firstUserId))
                .singleElement()
                .extracting(MatchParticipant::getResult)
                .isEqualTo(MatchResult.FORFEIT);
        assertThat(participants)
                .filteredOn(participant -> participant.getUser().getId().equals(secondUserId))
                .singleElement()
                .extracting(MatchParticipant::getResult)
                .isEqualTo(MatchResult.WIN);
        assertThat(events).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_RESULT_READY");
            assertThat(outbound.event().playback().result()).isEqualTo("RESIGNATION_WIN");
            assertThat(outbound.event().playback().winnerUserId()).isEqualTo(secondUserId);
            assertThat(outbound.event().playback().message()).isEqualTo("pilot-two wins by resignation.");
            assertThat(outbound.delayMillis()).isZero();
        });
    }

    private void stubSubmission(UUID userId, UUID submissionId) {
        ModelSubmission submission = new ModelSubmission();
        submission.setId(submissionId);
        submission.setUser(user(userId));
        submission.setArchitectureVersion("dense-movement-v1");
        submission.setMatchId(savedMatch.getId());
        submission.setFeatureSchemaVersion("arena-features-v1");
        submission.setActionSchemaVersion("movement-v1");
        submission.setTrainingMetrics("{}");
        submission.setModelArtifacts("{}");
        submission.setStatus(ModelSubmissionStatus.VALIDATED);
        when(modelSubmissionRepository.findByIdAndUserId(eq(submissionId), eq(userId)))
                .thenReturn(Optional.of(submission));
    }

    private AppUser user(UUID userId) {
        AppUser user = new AppUser();
        user.setId(userId);
        user.setUsername("pilot");
        user.setEmail(userId + "@example.com");
        user.setNormalizedEmail(userId + "@example.com");
        return user;
    }
}

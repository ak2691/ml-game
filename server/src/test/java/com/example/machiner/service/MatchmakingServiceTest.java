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
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

class MatchmakingServiceTest {

    private final MatchSimulationService simulationService = mock(MatchSimulationService.class);
    private final MatchRepository matchRepository = mock(MatchRepository.class);
    private final MatchParticipantRepository matchParticipantRepository = mock(MatchParticipantRepository.class);
    private final ModelSubmissionRepository modelSubmissionRepository = mock(ModelSubmissionRepository.class);
    private final ProfileRepository profileRepository = mock(ProfileRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final MutableClock clock = new MutableClock(Instant.parse("2026-06-03T12:00:00Z"), ZoneOffset.UTC);
    private final List<MatchPlaybackDTO.ObstaclePlacementDTO> matchObstacles = List.of(
            new MatchPlaybackDTO.ObstaclePlacementDTO("object_center", "radarJammer", 400.0, 400.0, 92),
            new MatchPlaybackDTO.ObstaclePlacementDTO("object_buff_1", "overdrive", 200.0, 400.0, 76, 0.0, 50),
            new MatchPlaybackDTO.ObstaclePlacementDTO("object_buff_2", "barrier", 600.0, 400.0, 76, 0.0, 50));
    private final List<MatchSession> simulatedSessions = new ArrayList<>();
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
                profileRepository,
                userRepository,
                clock);

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
        when(simulationService.buildMatchObstacles(any(MatchSession.class))).thenReturn(matchObstacles);
        when(simulationService.buildDuelPlayback(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            simulatedSessions.add(session);
            assertThat(session.obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .contains("object_center", "object_buff_1", "object_buff_2");
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
            assertThat(event.status()).isEqualTo("CLASS_SELECT");
            assertThat(event.matchId()).isNotNull();
            assertThat(event.players()).hasSize(2);
            assertThat(event.players()).extracting("slot").containsExactlyInAnyOrder(1, 2);
            assertThat(event.players()).extracting("selectedClass").containsOnly("custom::0,0,0,0");
            assertThat(event.players()).extracting("classSelected").containsOnly(false);
            assertThat(event.opponent()).isNotNull();
            assertThat(event.classSelectionEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:01:00Z"));
            assertThat(event.countdownEndsAt()).isNull();
            assertThat(event.trainingEndsAt()).isNull();
            assertThat(event.rulesetVersion()).isEqualTo("duel-v1");
            assertThat(event.obstacles()).isEmpty();
        });
        assertThat(participants).hasSize(2);
    }

    @Disabled("Replaced by combined loadout selection; object placement was removed")
    @Test
    void bothPlayersSelectingClassStartsObjectPlacementThenCountdown() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        List<MatchmakingService.OutboundMatchmakingEvent> firstSelection =
                service.selectClass(firstUserId, "ranged");
        assertThat(firstSelection).hasSize(2);
        assertThat(firstSelection).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_CLASS_SELECTED");
            assertThat(outbound.event().status()).isEqualTo("CLASS_SELECT");
            assertThat(outbound.event().player().selectedClass()).isIn("ranged", "melee");
            assertThat(outbound.event().countdownEndsAt()).isNull();
        });

        List<MatchmakingService.OutboundMatchmakingEvent> secondSelection =
                service.selectClass(secondUserId, "melee");
        assertThat(secondSelection).hasSize(2);
        assertThat(secondSelection).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_OBJECT_PLACEMENT_READY");
            assertThat(outbound.event().status()).isEqualTo("OBJECT_PLACEMENT");
            assertThat(outbound.event().objectPlacementEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:00:20Z"));
            assertThat(outbound.event().countdownEndsAt()).isNull();
            assertThat(outbound.event().players()).extracting("classSelected").containsOnly(true);
            assertThat(outbound.event().players()).extracting("selectedClass").containsExactlyInAnyOrder("ranged", "melee");
        });

        List<MatchmakingService.OutboundMatchmakingEvent> firstPlacement =
                service.submitObjectPlacements(firstUserId, List.of(playerObject("top-object", "healthPack", 300, 120, 42)));
        assertThat(firstPlacement).extracting(MatchmakingService.OutboundMatchmakingEvent::principalName)
                .containsExactlyInAnyOrder("pilot-one@example.com", "pilot-two@example.com");
        assertThat(firstPlacement).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("PLAYER_OBJECTS_PLACED");
            assertThat(outbound.event().status()).isEqualTo("OBJECT_PLACEMENT");
            assertThat(outbound.event().objectPlacementUserId()).isEqualTo(firstUserId);
            assertThat(outbound.event().obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .containsExactly("object_center", "object_buff_1", "object_buff_2");
            assertThat(outbound.event().players()).filteredOn("username", "pilot-one")
                    .extracting("objectPlacementSubmitted")
                    .containsExactly(true);
            assertThat(outbound.event().players()).filteredOn("username", "pilot-two")
                    .extracting("objectPlacementSubmitted")
                    .containsExactly(false);
        });
        assertThat(firstPlacement)
                .filteredOn(outbound -> outbound.event().player().username().equals("pilot-two"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().player().objectPlacementSubmitted()).isFalse();
                    assertThat(outbound.event().opponent().objectPlacementSubmitted()).isTrue();
                    assertThat(outbound.event().objectPlacements()).isEmpty();
                });
        assertThat(firstPlacement)
                .filteredOn(outbound -> outbound.event().player().username().equals("pilot-one"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().player().objectPlacementSubmitted()).isTrue();
                    assertThat(outbound.event().objectPlacements()).hasSize(1);
                    assertThat(outbound.event().objectPlacements().getFirst().type()).isEqualTo("healthPack");
                });

        List<MatchmakingService.OutboundMatchmakingEvent> secondPlacement =
                service.submitObjectPlacements(secondUserId, List.of(playerObject("bottom-object", "bouncyWall", 300, 700, 120)));
        assertThat(secondPlacement).hasSize(2);
        assertThat(secondPlacement).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_COUNTDOWN_READY");
            assertThat(outbound.event().status()).isEqualTo("COUNTDOWN");
            assertThat(outbound.event().objectPlacementEndsAt()).isNull();
            assertThat(outbound.event().countdownEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:00:05Z"));
            assertThat(outbound.event().trainingEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:10:05Z"));
            assertThat(outbound.event().obstacles()).hasSize(5);
            assertThat(outbound.event().obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .containsExactly("object_center", "object_buff_1", "object_buff_2", "object_1", "object_2");
        });
    }

    @Test
    void bothPlayersLockingLoadoutsStartsCountdownWithoutArenaObjects() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchmakingService.OutboundMatchmakingEvent> found =
                service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        Map<String, String> codes = Map.ofEntries(
                Map.entry("swing", "s"), Map.entry("block", "b"), Map.entry("dash", "d"), Map.entry("fire_gun", "g"),
                Map.entry("throw_grenade", "r"), Map.entry("shoot_fireball", "f"), Map.entry("stun", "t"), Map.entry("heavy_slash", "h"),
                Map.entry("repulsor_burst", "u"), Map.entry("concussive_shot", "c"), Map.entry("repair_pulse", "e"), Map.entry("proximity_mine", "m"),
                Map.entry("quick_jab", "j"), Map.entry("pistol_shot", "p"));
        var firstEvent = found.stream().map(MatchmakingService.OutboundMatchmakingEvent::event)
                .filter(event -> event.player().userId().equals(firstUserId)).findFirst().orElseThrow();
        var secondEvent = found.stream().map(MatchmakingService.OutboundMatchmakingEvent::event)
                .filter(event -> event.player().userId().equals(secondUserId)).findFirst().orElseThrow();
        assertThat(firstEvent.abilityOffers()).hasSize(6).doesNotHaveDuplicates();
        assertThat(secondEvent.abilityOffers()).hasSize(6).doesNotHaveDuplicates();
        assertThat(secondEvent.abilityOffers()).containsExactlyElementsOf(firstEvent.abilityOffers());
        String firstPicks = firstEvent.abilityOffers().stream().limit(3).map(codes::get).sorted().collect(java.util.stream.Collectors.joining());
        String secondPicks = secondEvent.abilityOffers().stream().limit(3).map(codes::get).sorted().collect(java.util.stream.Collectors.joining());

        service.selectClass(firstUserId, "custom:" + firstPicks + ":2,2,0,0");
        List<MatchmakingService.OutboundMatchmakingEvent> events =
                service.selectClass(secondUserId, "custom:" + secondPicks + ":0,0,1,3");

        assertThat(events).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_COUNTDOWN_READY");
            assertThat(outbound.event().status()).isEqualTo("COUNTDOWN");
            assertThat(outbound.event().objectPlacementEndsAt()).isNull();
            assertThat(outbound.event().obstacles()).isEmpty();
            assertThat(outbound.event().players()).extracting("selectedClass")
                    .containsExactlyInAnyOrder("custom:" + firstPicks + ":2,2,0,0", "custom:" + secondPicks + ":0,0,1,3");
        });
    }

    @Disabled("Object placement was removed")
    @Test
    void emptyObjectSubmissionIsAcknowledgedAndDoesNotCreatePlaceholderObjects() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectClass(firstUserId, "melee");
        service.selectClass(secondUserId, "melee");

        List<MatchmakingService.OutboundMatchmakingEvent> firstPlacement =
                service.submitObjectPlacements(firstUserId, List.of());

        assertThat(firstPlacement).hasSize(2);
        assertThat(firstPlacement).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("PLAYER_OBJECTS_PLACED");
            assertThat(outbound.event().objectPlacementUserId()).isEqualTo(firstUserId);
            assertThat(outbound.event().players()).filteredOn("username", "pilot-one")
                    .extracting("objectPlacementSubmitted")
                    .containsExactly(true);
            assertThat(outbound.event().players()).filteredOn("username", "pilot-two")
                    .extracting("objectPlacementSubmitted")
                    .containsExactly(false);
            assertThat(outbound.event().objectPlacements()).isEmpty();
        });

        List<MatchmakingService.OutboundMatchmakingEvent> secondPlacement =
                service.submitObjectPlacements(secondUserId,
                        List.of(playerObject("bottom-object", "healthPack", 300, 700, 42)));

        assertThat(secondPlacement).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_COUNTDOWN_READY");
            assertThat(outbound.event().obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .containsExactly("object_center", "object_buff_1", "object_buff_2", "object_1");
        });
    }

    @Disabled("Object placement was removed")
    @Test
    void objectSubmissionIsCappedAtThreeAndClampedToThePlayersThird() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectClass(firstUserId, "melee");
        service.selectClass(secondUserId, "melee");

        List<MatchmakingService.OutboundMatchmakingEvent> firstPlacement =
                service.submitObjectPlacements(firstUserId, List.of(
                        playerObject("one", "healthPack", -100, -100, 42),
                        playerObject("two", "projectileWall", 900, 900, 120),
                        playerObject("three", "bouncyWall", 400, 400, 120),
                        playerObject("ignored", "healthPack", 200, 200, 42)));

        assertThat(firstPlacement).filteredOn(outbound -> outbound.principalName().equals("pilot-one@example.com"))
                .singleElement()
                .satisfies(outbound -> {
                    assertThat(outbound.event().objectPlacements()).hasSize(3);
                    assertThat(outbound.event().objectPlacements()).allSatisfy(object -> {
                        assertThat(object.x()).isBetween(0.0, 1600.0);
                        assertThat(object.y()).isBetween(0.0, 1600.0 / 3.0);
                    });
                });

        List<MatchmakingService.OutboundMatchmakingEvent> secondPlacement =
                service.submitObjectPlacements(secondUserId, List.of());
        assertThat(secondPlacement).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().obstacles()).hasSize(6);
            assertThat(outbound.event().obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .containsExactly("object_center", "object_buff_1", "object_buff_2", "object_1", "object_2", "object_3");
        });
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

    @Disabled("Object placement was removed")
    @Test
    void objectPlacementTimeoutStartsCountdownWithNoObjectsWhenNobodySubmits() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchmakingService.OutboundMatchmakingEvent> matchEvents =
                service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = matchEvents.getFirst().event().matchId();
        service.selectClass(firstUserId, "melee");
        service.selectClass(secondUserId, "melee");

        clock.advance(Duration.ofSeconds(21));
        List<MatchmakingService.OutboundMatchmakingEvent> timeoutEvents =
                service.resolveObjectPlacementTimeout(matchId);

        assertThat(timeoutEvents).hasSize(2);
        assertThat(timeoutEvents).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_COUNTDOWN_READY");
            assertThat(outbound.event().status()).isEqualTo("COUNTDOWN");
            assertThat(outbound.event().obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .containsExactly("object_center", "object_buff_1", "object_buff_2");
            assertThat(outbound.event().countdownEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:00:26Z"));
            assertThat(outbound.event().trainingEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:10:26Z"));
        });
    }

    @Disabled("Old round/object lifecycle")
    @Test
    void firstRoundWinProducesPlaybackAndNextRoundEvents() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchmakingService.OutboundMatchmakingEvent> matchFoundEvents =
                service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        Long initialSeed = matchFoundEvents.getFirst().event().simulationSeed();
        service.selectClass(firstUserId, "melee");
        service.selectClass(secondUserId, "melee");
        service.submitObjectPlacements(firstUserId, List.of(playerObject("top-object", "healthPack", 300, 120, 42)));
        List<MatchmakingService.OutboundMatchmakingEvent> initialRoundEvents =
                service.submitObjectPlacements(secondUserId,
                        List.of(playerObject("bottom-object", "bouncyWall", 300, 700, 120)));
        List<MatchPlaybackDTO.ObstaclePlacementDTO> canonicalRoundObjects =
                initialRoundEvents.getFirst().event().obstacles();
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
                    assertThat(outbound.delayMillis()).isEqualTo(3_000L);
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
                    assertThat(outbound.event().simulationSeed()).isEqualTo(initialSeed);
                    assertThat(outbound.event().obstacles()).isEqualTo(canonicalRoundObjects);
                    assertThat(outbound.event().objectPlacementEndsAt()).isNull();
                    assertThat(outbound.event().countdownEndsAt()).isNotNull();
                    assertThat(outbound.event().player().finished()).isFalse();
                    assertThat(outbound.event().players()).extracting("roundWins").containsExactlyInAnyOrder(0, 1);
                    assertThat(outbound.delayMillis()).isPositive();
                });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.RUNNING);
    }

    @Disabled("Old round/object lifecycle")
    @Test
    void secondRoundWinCompletesBestOfThreeMatch() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectClass(firstUserId, "melee");
        service.selectClass(secondUserId, "melee");
        submitDefaultObjects(firstUserId, secondUserId);

        UUID firstRoundFirstSubmission = UUID.randomUUID();
        UUID firstRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, firstRoundFirstSubmission);
        stubSubmission(secondUserId, firstRoundSecondSubmission);
        service.markFinished(firstUserId, firstRoundFirstSubmission);
        service.markFinished(secondUserId, firstRoundSecondSubmission);
        assertThat(service.submitObjectPlacements(firstUserId,
                List.of(playerObject("ignored-second-round", "projectileWall", 180, 140, 120)))).isEmpty();

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

    @Disabled("Object placement was removed")
    @Test
    void laterRoundsReuseInitialObjectPlacementsAndSkipPlacement() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        service.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectClass(firstUserId, "melee");
        service.selectClass(secondUserId, "melee");
        submitDefaultObjects(firstUserId, secondUserId);

        UUID firstRoundFirstSubmission = UUID.randomUUID();
        UUID firstRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, firstRoundFirstSubmission);
        stubSubmission(secondUserId, firstRoundSecondSubmission);
        service.markFinished(firstUserId, firstRoundFirstSubmission);
        service.markFinished(secondUserId, firstRoundSecondSubmission);

        assertThat(service.submitObjectPlacements(firstUserId,
                List.of(playerObject("top-second-round", "projectileWall", 180, 140, 120)))).isEmpty();
        assertThat(service.submitObjectPlacements(secondUserId,
                List.of(playerObject("bottom-second-round", "healthPack", 620, 690, 42)))).isEmpty();

        UUID secondRoundFirstSubmission = UUID.randomUUID();
        UUID secondRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, secondRoundFirstSubmission);
        stubSubmission(secondUserId, secondRoundSecondSubmission);
        service.markFinished(firstUserId, secondRoundFirstSubmission);
        service.markFinished(secondUserId, secondRoundSecondSubmission);

        assertThat(simulatedSessions).hasSize(2);
        assertThat(simulatedSessions.get(1).obstacles())
                .filteredOn(obstacle -> obstacle.id().equals("object_1") || obstacle.id().equals("object_2"))
                .extracting(MatchPlaybackDTO.ObstaclePlacementDTO::type)
                .containsExactly("healthPack", "bouncyWall");
        assertThat(simulatedSessions.get(1).obstacles()).isEqualTo(simulatedSessions.get(0).obstacles());
        assertThat(simulatedSessions.get(1).obstacles())
                .filteredOn(obstacle -> obstacle.id().equals("object_1"))
                .singleElement()
                .satisfies(obstacle -> assertThat(obstacle.x()).isEqualTo(300.0));
        assertThat(simulatedSessions.get(1).obstacles())
                .filteredOn(obstacle -> obstacle.id().equals("object_2"))
                .singleElement()
                .satisfies(obstacle -> assertThat(obstacle.x()).isEqualTo(300.0));
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
        submission.setSelectedClass("melee");
        submission.setStatus(ModelSubmissionStatus.VALIDATED);
        when(modelSubmissionRepository.findByIdAndUserId(eq(submissionId), eq(userId)))
                .thenReturn(Optional.of(submission));
    }

    private void submitDefaultObjects(UUID firstUserId, UUID secondUserId) {
        service.submitObjectPlacements(firstUserId, List.of(playerObject("top-object", "healthPack", 300, 120, 42)));
        service.submitObjectPlacements(secondUserId, List.of(playerObject("bottom-object", "bouncyWall", 300, 700, 120)));
    }

    private MatchPlaybackDTO.ObstaclePlacementDTO playerObject(String id, String type, double x, double y, int size) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(id, type, x, y, size);
    }

    private AppUser user(UUID userId) {
        AppUser user = new AppUser();
        user.setId(userId);
        user.setUsername("pilot");
        user.setEmail(userId + "@example.com");
        user.setNormalizedEmail(userId + "@example.com");
        return user;
    }

    private static final class MutableClock extends Clock {
        private Instant instant;
        private final ZoneId zone;

        private MutableClock(Instant instant, ZoneId zone) {
            this.instant = instant;
            this.zone = zone;
        }

        private void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return new MutableClock(instant, zone);
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}

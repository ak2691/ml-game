package com.example.machiner.controller;

import com.example.machiner.DTO.MatchClassSelectionDTO;
import com.example.machiner.DTO.MatchFinishDTO;
import com.example.machiner.DTO.MatchObjectPlacementDTO;
import com.example.machiner.DTO.MatchPlaybackDTO;
import com.example.machiner.DTO.MatchmakingEventDTO;
import com.example.machiner.domain.AppUser;
import com.example.machiner.repository.UserRepository;
import com.example.machiner.service.AuthException;
import com.example.machiner.DTO.MatchmakingEventDTO;
import java.time.Instant;
import com.example.machiner.service.MatchmakingService;
import com.example.machiner.service.MatchmakingService.OutboundMatchmakingEvent;
import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

@Controller
public class MatchmakingSocketController {

    private final MatchmakingService matchmakingService;
    private final SimpMessagingTemplate messagingTemplate;
    private final UserRepository userRepository;

    public MatchmakingSocketController(
            MatchmakingService matchmakingService,
            SimpMessagingTemplate messagingTemplate,
            UserRepository userRepository) {
        this.matchmakingService = matchmakingService;
        this.messagingTemplate = messagingTemplate;
        this.userRepository = userRepository;
    }

    @MessageMapping("/matchmaking.join")
    public void joinQueue(Principal principal) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchmakingService.joinQueue(user.getId(), user.getUsername(), principal.getName());
        publish(events);
        scheduleClassSelectionTimeouts(events);
    }

    @MessageMapping("/matchmaking.leave")
    public void leaveQueue(Principal principal) {
        AppUser user = requireUser(principal);
        matchmakingService.leaveQueue(user.getId());
    }

    @MessageMapping("/matchmaking.finish")
    public void finish(@Payload MatchFinishDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchmakingService.markFinished(user.getId(), payload == null ? null : payload.modelSubmissionId());
        publish(events);
        scheduleClassSelectionTimeouts(events);
        scheduleObjectPlacementTimeouts(events);
    }

    @MessageExceptionHandler(AuthException.class)
    public void handleMatchmakingError(AuthException exception, Principal principal) {
        if (principal == null) return;
        messagingTemplate.convertAndSendToUser(
                principal.getName(),
                "/queue/matchmaking",
                new MatchmakingEventDTO(
                        "MATCH_ERROR",
                        null,
                        null,
                        "TRAINING",
                        null,
                        null,
                        List.of(),
                        Instant.now(),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        exception.getMessage(),
                        null,
                        List.of(),
                        List.of(),
                        List.of(),
                        null,
                        List.of(),
                        null));
    }

    @MessageMapping("/matchmaking.selectClass")
    public void selectClass(@Payload MatchClassSelectionDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchmakingService.selectClass(user.getId(), payload == null ? null : payload.selectedClass());
        publish(events);
        scheduleObjectPlacementTimeouts(events);
    }

    @MessageMapping("/matchmaking.placeObjects")
    public void placeObjects(@Payload MatchObjectPlacementDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchmakingService.submitObjectPlacements(
                user.getId(),
                toPlaybackObjects(payload));
        publish(events);
        scheduleObjectPlacementTimeouts(events);
    }

    @MessageMapping("/matchmaking.surrender")
    public void surrender(Principal principal) {
        AppUser user = requireUser(principal);
        publish(matchmakingService.surrender(user.getId()));
    }

    private AppUser requireUser(Principal principal) {
        if (principal == null || principal.getName() == null) {
            throw new AuthException("authentication is required");
        }
        return userRepository.findByNormalizedEmail(principal.getName().trim().toLowerCase())
                .orElseThrow(() -> new AuthException("authenticated user was not found"));
    }

    private List<MatchPlaybackDTO.ObstaclePlacementDTO> toPlaybackObjects(MatchObjectPlacementDTO payload) {
        if (payload == null || payload.objects() == null) {
            return List.of();
        }
        return payload.objects().stream()
                .filter(object -> object != null)
                .map(object -> new MatchPlaybackDTO.ObstaclePlacementDTO(
                        object.id(),
                        object.type(),
                        object.x(),
                        object.y(),
                        object.size(),
                        object.rotation()))
                .toList();
    }

    private void publish(List<OutboundMatchmakingEvent> events) {
        for (OutboundMatchmakingEvent event : events) {
            if (event.delayMillis() > 0) {
                CompletableFuture.delayedExecutor(event.delayMillis(), TimeUnit.MILLISECONDS)
                        .execute(() -> publish(event));
            } else {
                publish(event);
            }
        }
    }

    private void scheduleClassSelectionTimeouts(List<OutboundMatchmakingEvent> events) {
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> ("MATCH_FOUND".equals(event.type()) || "MATCH_ROUND_READY".equals(event.type()))
                        && "CLASS_SELECT".equals(event.status()))
                .filter(event -> event.matchId() != null)
                .collect(java.util.stream.Collectors.toMap(
                        MatchmakingEventDTO::matchId,
                        event -> event,
                        (first, second) -> first))
                .forEach((matchId, event) -> {
                    long delayMillis = event.classSelectionEndsAt() == null
                            ? TimeUnit.SECONDS.toMillis(60)
                            : Math.max(0, Duration.between(Instant.now(), event.classSelectionEndsAt()).toMillis());
                    CompletableFuture.delayedExecutor(delayMillis, TimeUnit.MILLISECONDS)
                        .execute(() -> {
                            List<OutboundMatchmakingEvent> timeoutEvents = matchmakingService.resolveClassSelectionTimeout(matchId);
                            publish(timeoutEvents);
                            scheduleObjectPlacementTimeouts(timeoutEvents);
                        });
                });
    }

    private void scheduleObjectPlacementTimeouts(List<OutboundMatchmakingEvent> events) {
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> "OBJECT_PLACEMENT".equals(event.status()))
                .filter(event -> event.matchId() != null)
                .forEach(event -> {
                    long delayMillis = event.objectPlacementEndsAt() == null
                            ? TimeUnit.SECONDS.toMillis(20)
                            : Math.max(0, Duration.between(Instant.now(), event.objectPlacementEndsAt()).toMillis());
                    CompletableFuture.delayedExecutor(delayMillis, TimeUnit.MILLISECONDS)
                            .execute(() -> publish(matchmakingService.resolveObjectPlacementTimeout(event.matchId())));
                });
    }

    private void publish(OutboundMatchmakingEvent event) {
        messagingTemplate.convertAndSendToUser(
                event.principalName(),
                "/queue/matchmaking",
                event.event());
    }
}

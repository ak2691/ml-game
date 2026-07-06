package com.example.machiner.controller;

import com.example.machiner.DTO.MatchClassSelectionDTO;
import com.example.machiner.DTO.MatchFinishDTO;
import com.example.machiner.DTO.MatchmakingEventDTO;
import com.example.machiner.domain.AppUser;
import com.example.machiner.repository.UserRepository;
import com.example.machiner.service.AuthException;
import com.example.machiner.service.MatchmakingService;
import com.example.machiner.service.MatchmakingService.OutboundMatchmakingEvent;
import java.security.Principal;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.springframework.messaging.handler.annotation.MessageMapping;
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
        publish(matchmakingService.markFinished(user.getId(), payload == null ? null : payload.modelSubmissionId()));
    }

    @MessageMapping("/matchmaking.selectClass")
    public void selectClass(@Payload MatchClassSelectionDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        publish(matchmakingService.selectClass(user.getId(), payload == null ? null : payload.selectedClass()));
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
                .filter(event -> "MATCH_FOUND".equals(event.type()) && "CLASS_SELECT".equals(event.status()))
                .map(MatchmakingEventDTO::matchId)
                .distinct()
                .forEach(matchId -> CompletableFuture.delayedExecutor(30, TimeUnit.SECONDS)
                        .execute(() -> publish(matchmakingService.resolveClassSelectionTimeout(matchId))));
    }

    private void publish(OutboundMatchmakingEvent event) {
        messagingTemplate.convertAndSendToUser(
                event.principalName(),
                "/queue/matchmaking",
                event.event());
    }
}

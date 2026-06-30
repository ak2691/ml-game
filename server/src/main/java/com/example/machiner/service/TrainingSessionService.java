package com.example.machiner.service;

import com.example.machiner.DTO.TrainingSessionResponseDTO;
import com.example.machiner.domain.TrainingSession;
import com.example.machiner.repository.TrainingSessionRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TrainingSessionService {

    private final TrainingSessionRepository trainingSessionRepository;
    private final CurrentUserService currentUserService;
    private final MatchmakingService matchmakingService;

    public TrainingSessionService(
            TrainingSessionRepository trainingSessionRepository,
            CurrentUserService currentUserService,
            MatchmakingService matchmakingService) {
        this.trainingSessionRepository = trainingSessionRepository;
        this.currentUserService = currentUserService;
        this.matchmakingService = matchmakingService;
    }

    @Transactional
    public TrainingSessionResponseDTO createSession(Authentication authentication, UUID matchId) {
        var user = currentUserService.requireCurrentUser(authentication);
        if (matchId != null) {
            matchmakingService.requireActiveMatchForUser(user.getId(), matchId);
        }

        TrainingSession session = new TrainingSession();
        session.setUser(user);
        session.setMatchId(matchId);
        session.setStartedAt(Instant.now());

        TrainingSession savedSession = trainingSessionRepository.save(session);
        return toResponse(savedSession, 0L, "Training session started");
    }

    @Transactional(readOnly = true)
    public TrainingSessionResponseDTO getDuration(UUID trainingSessionId, Authentication authentication) {
        TrainingSession session = trainingSessionRepository
                .findByIdAndUserId(trainingSessionId, currentUserService.requireCurrentUser(authentication).getId())
                .orElseThrow(() -> new TrainingSessionNotFoundException(trainingSessionId));
        long durationMs = Math.max(0, Duration.between(session.getStartedAt(), Instant.now()).toMillis());
        return toResponse(session, durationMs, "Server-owned training duration");
    }

    private TrainingSessionResponseDTO toResponse(
            TrainingSession session,
            Long trainingDurationMs,
            String message) {
        TrainingSessionResponseDTO response = new TrainingSessionResponseDTO();
        response.setTrainingSessionId(session.getId());
        response.setMatchId(session.getMatchId());
        response.setStartedAt(session.getStartedAt());
        response.setTrainingDurationMs(trainingDurationMs);
        response.setTrusted(true);
        response.setMessage(message);
        return response;
    }

}

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

    public TrainingSessionService(
            TrainingSessionRepository trainingSessionRepository,
            CurrentUserService currentUserService) {
        this.trainingSessionRepository = trainingSessionRepository;
        this.currentUserService = currentUserService;
    }

    @Transactional
    public TrainingSessionResponseDTO createSession(Authentication authentication) {
        TrainingSession session = new TrainingSession();
        session.setUser(currentUserService.requireCurrentUser(authentication));
        session.setStartedAt(Instant.now());

        TrainingSession savedSession = trainingSessionRepository.save(session);
        return toResponse(savedSession, 0L, "Training session started");
    }

    @Transactional(readOnly = true)
    public TrainingSessionResponseDTO getDuration(UUID trainingSessionId) {
        TrainingSession session = trainingSessionRepository.findById(trainingSessionId)
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
        response.setStartedAt(session.getStartedAt());
        response.setTrainingDurationMs(trainingDurationMs);
        response.setTrusted(true);
        response.setMessage(message);
        return response;
    }

}

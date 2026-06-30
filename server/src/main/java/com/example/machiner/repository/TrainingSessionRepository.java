package com.example.machiner.repository;

import com.example.machiner.domain.TrainingSession;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TrainingSessionRepository extends JpaRepository<TrainingSession, UUID> {

    Optional<TrainingSession> findByIdAndUserId(UUID id, UUID userId);
}

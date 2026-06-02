package com.example.machiner.repository;

import com.example.machiner.domain.TrainingSession;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TrainingSessionRepository extends JpaRepository<TrainingSession, UUID> {
}

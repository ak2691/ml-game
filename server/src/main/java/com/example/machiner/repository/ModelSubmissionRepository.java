package com.example.machiner.repository;

import com.example.machiner.domain.ModelSubmission;
import com.example.machiner.domain.ModelSubmissionStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ModelSubmissionRepository extends JpaRepository<ModelSubmission, UUID> {

    List<ModelSubmission> findByUserIdOrderBySubmittedAtDesc(UUID userId);

    List<ModelSubmission> findByStatusOrderBySubmittedAtAsc(ModelSubmissionStatus status);

    Optional<ModelSubmission> findByIdAndUserId(UUID id, UUID userId);

    Optional<ModelSubmission> findByModelHash(String modelHash);
}

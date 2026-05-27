package com.example.machiner.repository;

import com.example.machiner.domain.ValidationResult;
import com.example.machiner.domain.ValidationStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ValidationResultRepository extends JpaRepository<ValidationResult, UUID> {

    List<ValidationResult> findByModelSubmissionIdOrderByCreatedAtDesc(UUID modelSubmissionId);

    List<ValidationResult> findByStatusOrderByCreatedAtAsc(ValidationStatus status);
}

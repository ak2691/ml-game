package com.example.machiner.repository;

import com.example.machiner.domain.MatchParticipant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MatchParticipantRepository extends JpaRepository<MatchParticipant, UUID> {

    List<MatchParticipant> findByUserIdOrderByCreatedAtDesc(UUID userId);

    List<MatchParticipant> findByMatchId(UUID matchId);

    Optional<MatchParticipant> findByMatchIdAndUserId(UUID matchId, UUID userId);
}

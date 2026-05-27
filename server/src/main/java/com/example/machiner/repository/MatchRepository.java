package com.example.machiner.repository;

import com.example.machiner.domain.Match;
import com.example.machiner.domain.MatchStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MatchRepository extends JpaRepository<Match, UUID> {

    List<Match> findByStatusOrderByCreatedAtAsc(MatchStatus status);
}

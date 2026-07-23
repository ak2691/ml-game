package com.example.machiner.DTO;

import com.example.machiner.DTO.ProfileDTO.RecentMatchDTO;
import java.util.List;

public record MatchHistoryPageDTO(
        List<RecentMatchDTO> matches,
        int page,
        int pageSize,
        boolean hasMore,
        long totalMatches) {
}

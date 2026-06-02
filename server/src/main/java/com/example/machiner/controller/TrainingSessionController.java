package com.example.machiner.controller;

import com.example.machiner.DTO.TrainingSessionResponseDTO;
import com.example.machiner.service.TrainingSessionNotFoundException;
import com.example.machiner.service.TrainingSessionService;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/training-sessions")
public class TrainingSessionController {

    private final TrainingSessionService trainingSessionService;

    public TrainingSessionController(TrainingSessionService trainingSessionService) {
        this.trainingSessionService = trainingSessionService;
    }

    @PostMapping
    public ResponseEntity<TrainingSessionResponseDTO> createSession(Authentication authentication) {
        return ResponseEntity.status(HttpStatus.CREATED).body(trainingSessionService.createSession(authentication));
    }

    @GetMapping("/{trainingSessionId}/duration")
    public ResponseEntity<TrainingSessionResponseDTO> getTrustedDuration(
            @PathVariable UUID trainingSessionId) {
        return ResponseEntity.ok(trainingSessionService.getDuration(trainingSessionId));
    }

    @ExceptionHandler(TrainingSessionNotFoundException.class)
    public ResponseEntity<String> handleNotFound(TrainingSessionNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ex.getMessage());
    }
}

package com.example.machiner.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.machiner.DTO.ArenaPayloadDTO;
import com.example.machiner.DTO.CoordinateDTO;

@RestController
@RequestMapping("/api")
// Testing github actions new comment check
public class CoordinateController {

    private static final Logger log = LoggerFactory.getLogger(CoordinateController.class);

    @PostMapping("/coordinates")
    public ResponseEntity<String> receiveCoordinates(@RequestBody ArenaPayloadDTO payload) {

        // 1. Log the Main Player Model
        log.info("--- NEW ARENA PAYLOAD RECEIVED ---");
        log.info("Player Model -> X: {}, Y: {}",
                payload.getPlayerModel().getX(),
                payload.getPlayerModel().getY());

        // 2. Log the Environment Objects
        log.info("Environment Objects count: {}", payload.getObjects().size());
        log.info("Reward score: {}", payload.getReward());
        payload.getObjects().forEach(obj -> {
            log.info("   Obj [{}] - Type: {}, X: {}, Y: {}, Size: {}, Rotation: {}°",
                    obj.getId().substring(Math.max(0, obj.getId().length() - 4)), // Just print last 4 chars of ID
                    obj.getType(),
                    obj.getX(),
                    obj.getY(),
                    obj.getSize(),
                    obj.getRotation());
        });

        // 3. Return success to React
        return ResponseEntity
                .ok("Successfully received environment state with " + payload.getObjects().size() + " objects.");
    }
}

package com.example.machiner.controller;

import com.example.machiner.DTO.AuthRequestDTO;
import com.example.machiner.DTO.AuthUserDTO;
import com.example.machiner.service.AuthException;
import com.example.machiner.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public ResponseEntity<AuthUserDTO> register(
            @RequestBody AuthRequestDTO request,
            HttpServletRequest httpRequest) {
        return ResponseEntity.status(HttpStatus.CREATED).body(authService.register(request, httpRequest));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthUserDTO> login(
            @RequestBody AuthRequestDTO request,
            HttpServletRequest httpRequest) {
        return ResponseEntity.ok(authService.login(request, httpRequest));
    }

    @PostMapping("/logout")
    public ResponseEntity<AuthUserDTO> logout(
            HttpServletRequest request,
            HttpServletResponse response) {
        SecurityContextHolder.clearContext();
        if (request.getSession(false) != null) {
            request.getSession(false).invalidate();
        }
        return ResponseEntity.ok(AuthUserDTO.guest());
    }

    @GetMapping("/me")
    public ResponseEntity<AuthUserDTO> me(Authentication authentication) {
        return ResponseEntity.ok(authService.currentUser(authentication));
    }

    @ExceptionHandler(AuthException.class)
    public ResponseEntity<Map<String, String>> handleAuthException(AuthException ex) {
        return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
    }
}

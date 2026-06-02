package com.example.machiner.service;

import com.example.machiner.domain.AppUser;
import com.example.machiner.repository.UserRepository;
import com.example.machiner.security.AuthenticatedUserDetails;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CurrentUserService {

    private final UserRepository userRepository;

    public CurrentUserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Transactional(readOnly = true)
    public AppUser requireCurrentUser(Authentication authentication) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AuthenticatedUserDetails principal)) {
            throw new AuthException("authentication is required");
        }

        UUID userId = principal.getId();
        return userRepository.findById(userId)
                .orElseThrow(() -> new AuthException("authenticated user was not found"));
    }
}

package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.example.machiner.domain.AppUser;
import com.example.machiner.domain.TrainingSession;
import com.example.machiner.repository.TrainingSessionRepository;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;

class TrainingSessionServiceTest {

    private final TrainingSessionRepository trainingSessionRepository =
            org.mockito.Mockito.mock(TrainingSessionRepository.class);
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final TrainingSessionService service =
            new TrainingSessionService(trainingSessionRepository, currentUserService);

    @Test
    void createsServerOwnedTrainingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        when(trainingSessionRepository.save(any(TrainingSession.class))).thenAnswer(invocation -> {
            TrainingSession session = invocation.getArgument(0);
            setId(session, sessionId);
            return session;
        });

        var response = service.createSession(authentication);

        assertThat(response.getTrainingSessionId()).isEqualTo(sessionId);
        assertThat(response.getStartedAt()).isNotNull();
        assertThat(response.getTrainingDurationMs()).isZero();
        assertThat(response.isTrusted()).isTrue();
    }

    @Test
    void returnsTrustedDurationForExistingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        TrainingSession session = new TrainingSession();
        setId(session, sessionId);
        session.setStartedAt(Instant.now().minusSeconds(2));
        when(trainingSessionRepository.findById(sessionId)).thenReturn(Optional.of(session));

        var response = service.getDuration(sessionId);

        assertThat(response.getTrainingSessionId()).isEqualTo(sessionId);
        assertThat(response.getTrainingDurationMs()).isGreaterThanOrEqualTo(0);
        assertThat(response.isTrusted()).isTrue();
    }

    @Test
    void rejectsUnknownSessionDurationLookup() {
        UUID sessionId = UUID.randomUUID();
        when(trainingSessionRepository.findById(sessionId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getDuration(sessionId))
                .isInstanceOf(TrainingSessionNotFoundException.class)
                .hasMessageContaining(sessionId.toString());
    }

    private AppUser prototypeUser() {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername("prototype-local-player");
        user.setEmail("prototype@example.test");
        user.setNormalizedEmail("prototype@example.test");
        return user;
    }

    private Authentication authenticatedUser(AppUser user) {
        Authentication authentication = new UsernamePasswordAuthenticationToken("test", null);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        return authentication;
    }

    private void setId(TrainingSession session, UUID id) throws Exception {
        Field idField = TrainingSession.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(session, id);
    }
}

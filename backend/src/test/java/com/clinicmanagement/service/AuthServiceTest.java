package com.clinicmanagement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.clinicmanagement.dto.LoginRequest;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.exception.AuthApiException;
import com.clinicmanagement.repository.PatientRepository;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.GoogleIdTokenVerifier;
import java.time.Clock;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {
    @Test
    void disablingBetweenPasswordCheckAndLoginUpdateCannotIssueToken() {
        UserRepository users = mock(UserRepository.class);
        PasswordEncoder passwords = mock(PasswordEncoder.class);
        JwtTokenService tokens = mock(JwtTokenService.class);
        User user = mock(User.class);
        String email = UUID.randomUUID() + "@example.invalid";
        String password = UUID.randomUUID().toString();
        String hash = UUID.randomUUID().toString();
        when(passwords.encode(anyString())).thenReturn(hash);
        AuthService auth = new AuthService(users, mock(PatientRepository.class), passwords, tokens,
                Clock.systemUTC(), mock(AuditLogService.class), mock(GoogleIdTokenVerifier.class));
        when(users.findByEmail(email)).thenReturn(Optional.of(user));
        when(user.getId()).thenReturn(1L);
        when(user.getPasswordHash()).thenReturn(hash);
        when(user.getStatus()).thenReturn(UserStatus.ACTIVE);
        when(passwords.matches(password, hash)).thenReturn(true);
        // A concurrent disable makes the conditional timestamp update affect zero rows.
        when(users.recordLoginIfActive(any(), any(), any())).thenReturn(0);
        var exception = assertThrows(AuthApiException.class, () -> auth.login(new LoginRequest(email, password)));
        assertThat(exception.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(exception.getCode()).isEqualTo("INVALID_CREDENTIALS");
        verify(tokens, never()).issue(any());
    }
}

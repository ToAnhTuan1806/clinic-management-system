package com.clinicmanagement.service;

import com.clinicmanagement.config.JwtConfig;
import com.clinicmanagement.dto.LoginRequest;
import com.clinicmanagement.dto.LoginResponse;
import com.clinicmanagement.dto.RegisterRequest;
import com.clinicmanagement.dto.UserResponse;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.exception.AuthApiException;
import com.clinicmanagement.repository.UserRepository;
import java.time.Clock;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final JwtTokenService tokens;
    private final Clock clock;
    private final String dummyHash;

    public AuthService(UserRepository users, PasswordEncoder passwords, JwtTokenService tokens, Clock clock) {
        this.users = users;
        this.passwords = passwords;
        this.tokens = tokens;
        this.clock = clock;
        // Equalize BCrypt work for unknown emails without creating an account.
        this.dummyHash = passwords.encode(UUID.randomUUID().toString());
    }

    @Transactional
    public UserResponse register(RegisterRequest request) {
        if (users.existsByEmail(request.email())) {
            throw duplicateEmail();
        }
        User user = User.registerPatient(request.email(), passwords.encode(request.password()), request.fullName());
        try {
            return UserResponse.from(users.saveAndFlush(user));
        } catch (DataIntegrityViolationException exception) {
            // The database UNIQUE constraint also protects simultaneous registrations.
            throw duplicateEmail();
        }
    }

    @Transactional
    public LoginResponse login(LoginRequest request) {
        User user = users.findByEmail(request.email()).orElse(null);
        boolean matches = passwords.matches(request.password(), user == null ? dummyHash : user.getPasswordHash());
        if (!matches || user == null || user.getStatus() != UserStatus.ACTIVE) {
            throw invalidCredentials();
        }
        // Update only login timestamps, never overwrite a concurrent role/status/password change.
        if (users.recordLoginIfActive(user.getId(), clock.instant(), UserStatus.ACTIVE) != 1) {
            throw invalidCredentials();
        }
        user = users.findById(user.getId()).orElseThrow(this::invalidCredentials);
        return new LoginResponse(tokens.issue(user), "Bearer", JwtConfig.ACCESS_TOKEN_LIFETIME.toSeconds(),
                UserResponse.from(user));
    }

    private AuthApiException duplicateEmail() {
        return new AuthApiException(HttpStatus.CONFLICT, "EMAIL_ALREADY_EXISTS", "Email is already registered.");
    }

    private AuthApiException invalidCredentials() {
        return new AuthApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password.");
    }
}

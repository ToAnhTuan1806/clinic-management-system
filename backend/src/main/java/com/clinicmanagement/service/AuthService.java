package com.clinicmanagement.service;

import com.clinicmanagement.config.JwtConfig;
import com.clinicmanagement.dto.GoogleLoginRequest;
import com.clinicmanagement.dto.LoginRequest;
import com.clinicmanagement.dto.LoginResponse;
import com.clinicmanagement.dto.RegisterRequest;
import com.clinicmanagement.dto.UserResponse;
import com.clinicmanagement.entity.Patient;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.exception.AuthApiException;
import com.clinicmanagement.repository.PatientRepository;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.GoogleIdTokenVerifier;
import com.clinicmanagement.security.GoogleUserClaims;
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
    private final PatientRepository patients;
    private final PasswordEncoder passwords;
    private final JwtTokenService tokens;
    private final Clock clock;
    private final AuditLogService auditLogs;
    private final GoogleIdTokenVerifier googleVerifier;
    private final String dummyHash;

    public AuthService(UserRepository users, PatientRepository patients, PasswordEncoder passwords,
                       JwtTokenService tokens, Clock clock, AuditLogService auditLogs,
                       GoogleIdTokenVerifier googleVerifier) {
        this.users = users;
        this.patients = patients;
        this.passwords = passwords;
        this.tokens = tokens;
        this.clock = clock;
        this.auditLogs = auditLogs;
        this.googleVerifier = googleVerifier;
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
            User saved = users.saveAndFlush(user);
            auditLogs.recordSuccess(saved.getId(), saved.getRole(), AuditLogService.ACTION_USER_REGISTERED,
                    AuditLogService.ENTITY_USER, saved.getId(),
                    "user:" + saved.getId() + ":REGISTERED", null);
            return UserResponse.from(saved);
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

    @Transactional
    public LoginResponse loginWithGoogle(GoogleLoginRequest request) {
        GoogleUserClaims claims = googleVerifier.verify(request.idToken());
        User user = users.findByGoogleSub(claims.subject())
                .orElseGet(() -> users.findByEmail(claims.email()).orElse(null));

        if (user == null) {
            String unguessableHash = passwords.encode(UUID.randomUUID().toString());
            User created = User.registerGooglePatient(
                    claims.email(), unguessableHash, claims.fullName(), claims.subject());
            try {
                user = users.saveAndFlush(created);
            } catch (DataIntegrityViolationException exception) {
                throw new AuthApiException(HttpStatus.CONFLICT, "GOOGLE_ACCOUNT_CONFLICT",
                        "Unable to register Google account due to a concurrent sign-in. Please try again.");
            }
            ensurePatientProfile(user);
            auditLogs.recordSuccess(user.getId(), user.getRole(), AuditLogService.ACTION_USER_REGISTERED,
                    AuditLogService.ENTITY_USER, user.getId(),
                    "user:" + user.getId() + ":GOOGLE_REGISTERED", null);
        } else {
            if (user.getRole() != Role.PATIENT) {
                throw new AuthApiException(HttpStatus.FORBIDDEN, "GOOGLE_LOGIN_NOT_ALLOWED",
                        "Google sign-in is only available for patient accounts.");
            }
            if (user.getStatus() != UserStatus.ACTIVE) {
                throw invalidCredentials();
            }
            if (user.getGoogleSub() == null) {
                user.linkGoogleSub(claims.subject());
                users.saveAndFlush(user);
            } else if (!user.getGoogleSub().equals(claims.subject())) {
                throw new AuthApiException(HttpStatus.CONFLICT, "GOOGLE_ACCOUNT_MISMATCH",
                        "This email is already linked to a different Google account.");
            }
            ensurePatientProfile(user);
        }

        if (users.recordLoginIfActive(user.getId(), clock.instant(), UserStatus.ACTIVE) != 1) {
            throw invalidCredentials();
        }
        user = users.findById(user.getId()).orElseThrow(this::invalidCredentials);
        return new LoginResponse(tokens.issue(user), "Bearer", JwtConfig.ACCESS_TOKEN_LIFETIME.toSeconds(),
                UserResponse.from(user));
    }

    private void ensurePatientProfile(User user) {
        if (!patients.existsByUserId(user.getId())) {
            String code = "PT-G-" + user.getId();
            patients.saveAndFlush(new Patient(user, code, user.getFullName(), null, null,
                    user.getPhone(), user.getAddress(), true));
        }
    }

    private AuthApiException duplicateEmail() {
        return new AuthApiException(HttpStatus.CONFLICT, "EMAIL_ALREADY_EXISTS", "Email is already registered.");
    }

    private AuthApiException invalidCredentials() {
        return new AuthApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password.");
    }
}

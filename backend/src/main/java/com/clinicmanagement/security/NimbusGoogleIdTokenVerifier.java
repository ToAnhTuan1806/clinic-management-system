package com.clinicmanagement.security;

import com.clinicmanagement.exception.AuthApiException;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;

@Component
public class NimbusGoogleIdTokenVerifier implements GoogleIdTokenVerifier {
    private static final String GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
    private static final Set<String> ALLOWED_ISSUERS = Set.of("https://accounts.google.com", "accounts.google.com");
    private static final int MAX_FULL_NAME_LENGTH = 120;

    private final String clientId;
    private volatile JwtDecoder decoder;

    public NimbusGoogleIdTokenVerifier(
            @Value("${clinic.security.google.client-id:}") String clientId) {
        this.clientId = clientId == null ? "" : clientId.trim();
    }

    @Override
    public GoogleUserClaims verify(String idToken) {
        if (clientId.isEmpty()) {
            throw new AuthApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "GOOGLE_AUTH_NOT_CONFIGURED", "Google sign-in is not configured.");
        }
        try {
            Jwt jwt = getDecoder().decode(idToken);
            String subject = jwt.getSubject();
            String email = jwt.getClaimAsString("email");
            Boolean emailVerified = jwt.getClaimAsBoolean("email_verified");
            if (subject == null || subject.isBlank() || email == null || email.isBlank()
                    || !Boolean.TRUE.equals(emailVerified)) {
                throw invalidToken();
            }
            String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);
            String rawName = jwt.getClaimAsString("name");
            String fullName = normalizeFullName(rawName, normalizedEmail);
            return new GoogleUserClaims(subject.trim(), normalizedEmail, fullName, true);
        } catch (AuthApiException exception) {
            throw exception;
        } catch (JwtException | IllegalArgumentException exception) {
            throw invalidToken();
        }
    }

    private JwtDecoder getDecoder() {
        JwtDecoder existing = decoder;
        if (existing != null) {
            return existing;
        }
        synchronized (this) {
            if (decoder == null) {
                NimbusJwtDecoder nimbus = NimbusJwtDecoder.withJwkSetUri(GOOGLE_JWKS_URI)
                        .jwsAlgorithm(SignatureAlgorithm.RS256)
                        .build();
                OAuth2TokenValidator<Jwt> issuerValidator = jwt -> {
                    String issuer = jwt.getClaimAsString("iss");
                    return issuer != null && ALLOWED_ISSUERS.contains(issuer)
                            ? OAuth2TokenValidatorResult.success()
                            : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Invalid issuer", null));
                };
                OAuth2TokenValidator<Jwt> audienceValidator = jwt -> {
                    List<String> audiences = jwt.getAudience();
                    return audiences != null && audiences.contains(clientId)
                            ? OAuth2TokenValidatorResult.success()
                            : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Invalid audience", null));
                };
                nimbus.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                        new JwtTimestampValidator(), issuerValidator, audienceValidator));
                decoder = nimbus;
            }
            return decoder;
        }
    }

    private String normalizeFullName(String rawName, String fallbackEmail) {
        String candidate = (rawName == null || rawName.isBlank())
                ? fallbackEmail.substring(0, Math.max(1, fallbackEmail.indexOf('@')))
                : rawName.trim();
        return candidate.length() > MAX_FULL_NAME_LENGTH
                ? candidate.substring(0, MAX_FULL_NAME_LENGTH).trim()
                : candidate;
    }

    private AuthApiException invalidToken() {
        return new AuthApiException(HttpStatus.UNAUTHORIZED, "INVALID_GOOGLE_TOKEN",
                "Invalid or expired Google credential.");
    }
}

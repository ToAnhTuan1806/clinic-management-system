package com.clinicmanagement.config;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

@Configuration
public class JwtConfig {
    public static final Duration ACCESS_TOKEN_LIFETIME = Duration.ofMinutes(30);

    @Bean
    Clock applicationClock() {
        return Clock.systemUTC();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    SecretKey jwtSigningKey(Environment environment) {
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(environment.getProperty("clinic.security.jwt.secret-base64", ""));
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("JWT_SECRET must be Base64 encoding of at least 32 random bytes.");
        }
        if (bytes.length < 32) {
            throw new IllegalStateException("JWT_SECRET must be Base64 encoding of at least 32 random bytes.");
        }
        return new SecretKeySpec(bytes, "HmacSHA256");
    }

    @Bean
    JwtEncoder jwtEncoder(SecretKey jwtSigningKey) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(jwtSigningKey));
    }

    @Bean
    JwtDecoder jwtDecoder(SecretKey jwtSigningKey, Clock clock,
                          @Value("${clinic.security.jwt.issuer}") String issuer) {
        if (issuer.isBlank()) {
            throw new IllegalStateException("JWT_ISSUER must not be blank.");
        }
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(jwtSigningKey)
                .macAlgorithm(MacAlgorithm.HS256).build();
        JwtTimestampValidator timestamp = new JwtTimestampValidator(Duration.ZERO);
        timestamp.setClock(clock);
        OAuth2TokenValidator<Jwt> requiredClaims = jwt -> {
            Instant now = clock.instant();
            Instant issued = jwt.getIssuedAt();
            Instant expires = jwt.getExpiresAt();
            boolean valid = jwt.getSubject() != null && jwt.getSubject().matches("[1-9][0-9]{0,18}")
                    && issued != null && expires != null && !issued.isAfter(now)
                    && expires.isAfter(now) && expires.isAfter(issued)
                    && Duration.between(issued, expires).compareTo(ACCESS_TOKEN_LIFETIME) <= 0;
            return valid ? OAuth2TokenValidatorResult.success() : OAuth2TokenValidatorResult.failure(
                    new OAuth2Error("invalid_token", "Invalid access token.", null));
        };
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(timestamp,
                new JwtIssuerValidator(issuer), requiredClaims));
        return decoder;
    }
}

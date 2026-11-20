package com.clinicmanagement.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

class JwtConfigTest {
    private final JwtConfig configuration = new JwtConfig();
    private final Instant now = Instant.parse("2026-11-20T00:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);

    @Test
    void rejectsMissingMalformedAndWeakKeyWithoutRevealingValue() {
        for (String value : new String[]{"", UUID.randomUUID() + "!", Base64.getEncoder().encodeToString(new byte[16])}) {
            var error = assertThrows(IllegalStateException.class, () -> configuration.jwtSigningKey(
                    new MockEnvironment().withProperty("clinic.security.jwt.secret-base64", value)));
            if (!value.isEmpty()) {
                assertThat(error.getMessage().contains(value)).isFalse();
            }
            assertThat(error.getCause()).isNull();
        }
    }

    @Test
    void acceptsValidHs256ButRejectsWrongSignatureHs384AndUnsignedJwt() {
        SecretKey key = key();
        var decoder = configuration.jwtDecoder(key, clock, "clinic-management");
        String valid = encode(key, MacAlgorithm.HS256);
        assertThat(decoder.decode(valid).getSubject()).isEqualTo("1");
        assertThrows(JwtException.class, () -> decoder.decode(encode(key(), MacAlgorithm.HS256)));
        assertThrows(JwtException.class, () -> decoder.decode(encode(key, MacAlgorithm.HS384)));
        var unsigned = new PlainJWT(new JWTClaimsSet.Builder().subject("1").issuer("clinic-management")
                .issueTime(Date.from(now.minusSeconds(1))).expirationTime(Date.from(now.plusSeconds(60))).build());
        assertThrows(JwtException.class, () -> decoder.decode(unsigned.serialize()));
    }

    private String encode(SecretKey key, MacAlgorithm algorithm) {
        var encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        var claims = JwtClaimsSet.builder().issuer("clinic-management").subject("1")
                .issuedAt(now.minusSeconds(1)).expiresAt(now.plusSeconds(60)).build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(algorithm).type("JWT").build(), claims))
                .getTokenValue();
    }

    private SecretKey key() {
        byte[] bytes = new byte[64];
        new SecureRandom().nextBytes(bytes);
        return new SecretKeySpec(bytes, "HmacSHA256");
    }
}

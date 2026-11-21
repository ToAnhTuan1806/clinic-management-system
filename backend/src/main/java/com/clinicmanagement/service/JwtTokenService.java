package com.clinicmanagement.service;

import com.clinicmanagement.config.JwtConfig;
import com.clinicmanagement.entity.User;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

@Service
public class JwtTokenService {
    private final JwtEncoder encoder;
    private final Clock clock;
    private final String issuer;

    public JwtTokenService(JwtEncoder encoder, Clock clock,
                           @Value("${clinic.security.jwt.issuer}") String issuer) {
        this.encoder = encoder;
        this.clock = clock;
        this.issuer = issuer;
    }

    public String issue(User user) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        var claims = JwtClaimsSet.builder().issuer(issuer).subject(user.getId().toString())
                .issuedAt(now).expiresAt(now.plus(JwtConfig.ACCESS_TOKEN_LIFETIME)).build();
        var header = JwsHeader.with(MacAlgorithm.HS256).type("JWT").build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }
}

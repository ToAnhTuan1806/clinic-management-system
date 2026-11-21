package com.clinicmanagement.security;

import com.clinicmanagement.entity.User;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.repository.UserRepository;
import java.util.List;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class ActiveUserJwtConverter implements Converter<Jwt, AbstractAuthenticationToken> {
    private final UserRepository users;

    public ActiveUserJwtConverter(UserRepository users) {
        this.users = users;
    }

    @Override
    @Transactional(readOnly = true)
    public AbstractAuthenticationToken convert(Jwt jwt) {
        long id;
        try {
            id = Long.parseLong(jwt.getSubject());
        } catch (RuntimeException exception) {
            throw new InvalidBearerTokenException("Invalid access token.");
        }
        User user = users.findById(id).filter(value -> value.getStatus() == UserStatus.ACTIVE)
                .orElseThrow(() -> new InvalidBearerTokenException("Invalid access token."));
        var principal = new AuthenticatedUser(user.getId(), user.getEmail(), user.getFullName(),
                user.getRole(), user.getStatus());
        // Read current roles from the database; never trust token-supplied authorities.
        return UsernamePasswordAuthenticationToken.authenticated(principal, null,
                List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name())));
    }
}

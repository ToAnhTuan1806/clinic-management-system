package com.clinicmanagement.config;

import com.clinicmanagement.exception.ApiProblems;
import com.clinicmanagement.security.ActiveUserJwtConverter;
import jakarta.servlet.DispatcherType;
import java.io.IOException;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.DefaultCorsProcessor;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import tools.jackson.databind.ObjectMapper;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, ObjectMapper objectMapper,
            ActiveUserJwtConverter converter,
            @Value("${clinic.security.cors.allowed-origins:}") String allowedOrigins) throws Exception {
        AuthenticationEntryPoint unauthorized = (request, response, exception) -> {
            response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
            boolean supplied = request.getHeader(HttpHeaders.AUTHORIZATION) != null;
            ApiProblems.write(response, objectMapper, HttpStatus.UNAUTHORIZED,
                    supplied ? "INVALID_ACCESS_TOKEN" : "AUTHENTICATION_REQUIRED",
                    supplied ? "Invalid access token." : "Authentication is required.", request.getRequestURI());
        };
        AccessDeniedHandler forbidden = (request, response, exception) ->
                ApiProblems.write(response, objectMapper, HttpStatus.FORBIDDEN,
                        "ACCESS_DENIED", "Access is denied.", request.getRequestURI());
        return http
                .authorizeHttpRequests(authorize -> authorize
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/health").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/register", "/api/v1/auth/login").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/auth/me")
                            .hasAnyRole("ADMIN", "DOCTOR", "RECEPTIONIST", "PATIENT")
                        .requestMatchers(HttpMethod.GET, "/api/v1/me/profile")
                            .hasAnyRole("ADMIN", "DOCTOR", "RECEPTIONIST", "PATIENT")
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/me/profile")
                            .hasAnyRole("ADMIN", "DOCTOR", "RECEPTIONIST", "PATIENT")
                        .requestMatchers(HttpMethod.GET, "/api/v1/me/patient-profile")
                            .hasRole("PATIENT")
                        .requestMatchers(HttpMethod.GET, "/api/v1/patients")
                            .hasAnyRole("ADMIN", "RECEPTIONIST")
                        .requestMatchers(HttpMethod.POST, "/api/v1/patients")
                            .hasAnyRole("ADMIN", "RECEPTIONIST")
                        .requestMatchers(HttpMethod.GET, "/api/v1/patients/*")
                            .hasAnyRole("ADMIN", "RECEPTIONIST", "PATIENT")
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/patients/*")
                            .hasAnyRole("ADMIN", "RECEPTIONIST")
                        .requestMatchers(HttpMethod.GET, "/api/v1/doctors/eligible-users").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.GET, "/api/v1/doctors", "/api/v1/doctors/*",
                                "/api/v1/specialties", "/api/v1/specialties/*")
                            .hasAnyRole("ADMIN", "DOCTOR", "RECEPTIONIST", "PATIENT")
                        .requestMatchers(HttpMethod.POST, "/api/v1/doctors", "/api/v1/specialties").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/doctors/*", "/api/v1/specialties/*").hasRole("ADMIN")
                        .anyRequest().denyAll())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                // Credentials are only explicit Authorization headers, never cookies or sessions.
                .csrf(csrf -> csrf.disable())
                .cors(cors -> cors.disable())
                .addFilterBefore(corsFilter(allowedOrigins, objectMapper), CsrfFilter.class)
                .oauth2ResourceServer(resource -> resource
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(converter))
                        .authenticationEntryPoint(unauthorized).accessDeniedHandler(forbidden))
                .exceptionHandling(errors -> errors.authenticationEntryPoint(unauthorized)
                        .accessDeniedHandler(forbidden))
                .build();
    }

    @Bean
    UserDetailsService userDetailsService() {
        // JWT uses ActiveUserJwtConverter. Never generate a development account/password.
        return new InMemoryUserDetailsManager();
    }

    private CorsFilter corsFilter(String origins, ObjectMapper mapper) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(CorsOrigins.parse(origins));
        configuration.setAllowedMethods(List.of("GET", "POST", "PATCH", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        configuration.setExposedHeaders(List.of("Location"));
        configuration.setAllowCredentials(false);
        configuration.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        CorsFilter filter = new CorsFilter(source);
        // Keep CORS rejections in the same safe Problem Details format as API errors.
        filter.setCorsProcessor((config, request, response) -> new DefaultCorsProcessor() {
            @Override
            protected void rejectRequest(ServerHttpResponse output) throws IOException {
                ApiProblems.write(response, mapper, HttpStatus.FORBIDDEN, "CORS_REJECTED",
                        "Origin, method or headers are not allowed.", request.getRequestURI());
            }
        }.processRequest(config, request, response));
        // This filter is added only inside SecurityFilterChain, not registered as a servlet filter bean.
        return filter;
    }
}

package com.clinicmanagement.config;

import com.clinicmanagement.exception.ApiProblems;
import com.clinicmanagement.security.ActiveUserJwtConverter;
import com.clinicmanagement.security.AuthRateLimitFilter;
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
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.header.writers.StaticHeadersWriter;
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
            @Value("${clinic.security.cors.allowed-origins:}") String allowedOrigins,
            @Value("${clinic.security.rate-limit.enabled:true}") boolean rateLimitEnabled,
            @Value("${clinic.security.rate-limit.login-max-requests:10}") int loginMaxRequests,
            @Value("${clinic.security.rate-limit.register-max-requests:5}") int registerMaxRequests,
            @Value("${clinic.security.rate-limit.window-seconds:60}") long rateLimitWindowSeconds) throws Exception {
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
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/register", "/api/v1/auth/login",
                                "/api/v1/auth/google").permitAll()
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
                        .requestMatchers(HttpMethod.POST, "/api/v1/doctor-schedules")
                            .hasAnyRole("ADMIN", "RECEPTIONIST")
                        .requestMatchers(HttpMethod.GET, "/api/v1/doctor-schedules", "/api/v1/doctor-schedules/*")
                            .hasAnyRole("ADMIN", "RECEPTIONIST", "DOCTOR")
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/doctor-schedules/*")
                            .hasAnyRole("ADMIN", "RECEPTIONIST")
                        .requestMatchers(HttpMethod.GET, "/api/v1/doctors/*/schedule-slots")
                            .hasAnyRole("ADMIN", "RECEPTIONIST", "DOCTOR", "PATIENT")
                        .requestMatchers(HttpMethod.POST,
                                "/api/v1/appointments/*/confirmation",
                                "/api/v1/appointments/*/check-in",
                                "/api/v1/appointments/*/no-show")
                            .hasRole("RECEPTIONIST")
                        .requestMatchers(HttpMethod.POST, "/api/v1/appointments")
                            .hasAnyRole("RECEPTIONIST", "PATIENT")
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/appointments/*/slot")
                            .hasAnyRole("RECEPTIONIST", "PATIENT")
                        .requestMatchers(HttpMethod.POST, "/api/v1/appointments/*/cancellation")
                            .hasAnyRole("RECEPTIONIST", "PATIENT")
                        .requestMatchers(HttpMethod.GET, "/api/v1/appointments", "/api/v1/appointments/*")
                            .hasAnyRole("ADMIN", "RECEPTIONIST", "DOCTOR", "PATIENT")
                        .requestMatchers(HttpMethod.GET, "/api/v1/medical-records/*/prescription")
                            .hasAnyRole("DOCTOR", "PATIENT")
                        .requestMatchers(HttpMethod.PUT, "/api/v1/medical-records/*/prescription")
                            .hasRole("DOCTOR")
                        .requestMatchers(HttpMethod.POST, "/api/v1/medical-records",
                                "/api/v1/medical-records/*/completion").hasRole("DOCTOR")
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/medical-records/*").hasRole("DOCTOR")
                        .requestMatchers(HttpMethod.GET, "/api/v1/medical-records/*",
                                "/api/v1/medical-records/by-appointment/*")
                            .hasAnyRole("ADMIN", "DOCTOR", "RECEPTIONIST", "PATIENT")
                        .requestMatchers(HttpMethod.POST, "/api/v1/medical-records/*/release").hasRole("DOCTOR")
                        .requestMatchers(HttpMethod.GET, "/api/v1/patients/*/medical-history")
                            .hasAnyRole("ADMIN", "DOCTOR", "RECEPTIONIST", "PATIENT")
                        .requestMatchers(HttpMethod.GET, "/api/v1/dashboard/summary")
                            .hasAnyRole("ADMIN", "RECEPTIONIST", "DOCTOR")
                        .requestMatchers(HttpMethod.GET, "/api/v1/notifications")
                            .hasAnyRole("ADMIN", "RECEPTIONIST", "DOCTOR", "PATIENT")
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/notifications/*/read")
                            .hasAnyRole("ADMIN", "RECEPTIONIST", "DOCTOR", "PATIENT")
                        .requestMatchers(HttpMethod.GET, "/api/v1/reports/visits")
                            .hasAnyRole("ADMIN", "RECEPTIONIST", "DOCTOR")
                        .requestMatchers(HttpMethod.GET, "/api/v1/audit-logs")
                            .hasRole("ADMIN")
                        .anyRequest().denyAll())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                // Credentials are only explicit Authorization headers, never cookies or sessions.
                .csrf(csrf -> csrf.disable())
                .cors(cors -> cors.disable())
                .headers(headers -> headers
                        .contentTypeOptions(Customizer.withDefaults())
                        .frameOptions(frame -> frame.deny())
                        .contentSecurityPolicy(csp -> csp
                                .policyDirectives("default-src 'none'; frame-ancestors 'none'"))
                        .referrerPolicy(referrer -> referrer
                                .policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                        .addHeaderWriter(new StaticHeadersWriter(
                                "Permissions-Policy", "geolocation=(), microphone=(), camera=()")))
                .addFilterBefore(corsFilter(allowedOrigins, objectMapper), CsrfFilter.class)
                .addFilterAfter(new AuthRateLimitFilter(
                        rateLimitEnabled, loginMaxRequests, registerMaxRequests,
                        rateLimitWindowSeconds, objectMapper), CorsFilter.class)
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
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "OPTIONS"));
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

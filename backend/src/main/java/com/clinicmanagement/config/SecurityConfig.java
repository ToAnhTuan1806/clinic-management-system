package com.clinicmanagement.config;

import com.clinicmanagement.exception.ApiProblems;
import jakarta.servlet.DispatcherType;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import tools.jackson.databind.ObjectMapper;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, ObjectMapper objectMapper) throws Exception {
        return http
                .authorizeHttpRequests(authorize -> authorize
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/health").permitAll()
                        .anyRequest().denyAll())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                .cors(Customizer.withDefaults())
                // Keep CSRF protection until the authentication transport is agreed with FE.
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, exception) ->
                                ApiProblems.write(response, objectMapper, HttpStatus.UNAUTHORIZED,
                                        "AUTHENTICATION_REQUIRED", "Authentication is required.", request.getRequestURI()))
                        .accessDeniedHandler((request, response, exception) ->
                                ApiProblems.write(response, objectMapper, HttpStatus.FORBIDDEN,
                                        "ACCESS_DENIED", "Access is denied.", request.getRequestURI())))
                .build();
    }

    @Bean
    UserDetailsService userDetailsService() {
        // No generated development account or password; authentication is outside D01.
        return new InMemoryUserDetailsManager();
    }
}

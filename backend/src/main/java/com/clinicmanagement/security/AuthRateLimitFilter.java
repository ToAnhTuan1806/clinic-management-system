package com.clinicmanagement.security;

import com.clinicmanagement.exception.ApiProblems;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

/**
 * In-memory fixed-window rate limiter for public authentication endpoints.
 * Protects BCrypt(12) login/registration against brute-force and CPU exhaustion.
 */
public class AuthRateLimitFilter extends OncePerRequestFilter {
    private static final String LOGIN_PATH = "/api/v1/auth/login";
    private static final String GOOGLE_LOGIN_PATH = "/api/v1/auth/google";
    private static final String REGISTER_PATH = "/api/v1/auth/register";
    private static final int MAX_BUCKETS = 10_000;

    private final boolean enabled;
    private final int loginMaxRequests;
    private final int registerMaxRequests;
    private final long windowSeconds;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final ConcurrentHashMap<String, WindowBucket> buckets = new ConcurrentHashMap<>();

    public AuthRateLimitFilter(boolean enabled, int loginMaxRequests, int registerMaxRequests,
                               long windowSeconds, ObjectMapper objectMapper) {
        this(enabled, loginMaxRequests, registerMaxRequests, windowSeconds, objectMapper, Clock.systemUTC());
    }

    AuthRateLimitFilter(boolean enabled, int loginMaxRequests, int registerMaxRequests,
                        long windowSeconds, ObjectMapper objectMapper, Clock clock) {
        this.enabled = enabled;
        this.loginMaxRequests = Math.max(1, loginMaxRequests);
        this.registerMaxRequests = Math.max(1, registerMaxRequests);
        this.windowSeconds = Math.max(1L, windowSeconds);
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        if (!enabled || !HttpMethod.POST.matches(request.getMethod())) {
            filterChain.doFilter(request, response);
            return;
        }

        String path = request.getRequestURI();
        int limit;
        String scope;
        if (LOGIN_PATH.equals(path) || GOOGLE_LOGIN_PATH.equals(path)) {
            limit = loginMaxRequests;
            scope = "login";
        } else if (REGISTER_PATH.equals(path)) {
            limit = registerMaxRequests;
            scope = "register";
        } else {
            filterChain.doFilter(request, response);
            return;
        }

        long nowEpochSeconds = clock.instant().getEpochSecond();
        evictIfNeeded(nowEpochSeconds);

        // Use servlet remoteAddr directly; never trust raw spoofable X-Forwarded-For headers.
        String clientIp = request.getRemoteAddr();
        String key = scope + ":" + (clientIp == null || clientIp.isBlank() ? "unknown" : clientIp);

        long retryAfter = tryConsume(key, limit, nowEpochSeconds);
        if (retryAfter > 0) {
            response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfter));
            ApiProblems.write(response, objectMapper, HttpStatus.TOO_MANY_REQUESTS,
                    "RATE_LIMIT_EXCEEDED",
                    "Too many authentication requests. Please try again later.",
                    path);
            return;
        }

        filterChain.doFilter(request, response);
    }

    private long tryConsume(String key, int limit, long nowEpochSeconds) {
        long[] retryAfterHolder = {0L};
        buckets.compute(key, (ignored, existing) -> {
            if (existing == null || nowEpochSeconds - existing.windowStartEpochSeconds >= windowSeconds) {
                return new WindowBucket(nowEpochSeconds, 1);
            }
            if (existing.count >= limit) {
                long remaining = windowSeconds - (nowEpochSeconds - existing.windowStartEpochSeconds);
                retryAfterHolder[0] = Math.max(1L, remaining);
                return existing;
            }
            return new WindowBucket(existing.windowStartEpochSeconds, existing.count + 1);
        });
        return retryAfterHolder[0];
    }

    private void evictIfNeeded(long nowEpochSeconds) {
        if (buckets.size() < MAX_BUCKETS) {
            return;
        }
        buckets.entrySet().removeIf(entry ->
                nowEpochSeconds - entry.getValue().windowStartEpochSeconds >= windowSeconds);
        if (buckets.size() >= MAX_BUCKETS) {
            buckets.clear();
        }
    }

    private record WindowBucket(long windowStartEpochSeconds, int count) {
    }
}

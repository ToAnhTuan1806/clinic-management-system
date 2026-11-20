package com.clinicmanagement.config;

import java.net.URI;
import java.util.Arrays;
import java.util.List;

public final class CorsOrigins {
    private CorsOrigins() {
    }

    public static List<String> parse(String configured) {
        if (configured.isBlank()) {
            return List.of();
        }
        List<String> origins = Arrays.stream(configured.split(",", -1)).map(String::trim).distinct().toList();
        for (String origin : origins) {
            try {
                URI uri = URI.create(origin);
                if (origin.contains("*") || uri.getHost() == null || uri.getUserInfo() != null
                        || !("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                        || !uri.getRawPath().isEmpty() || uri.getQuery() != null || uri.getFragment() != null
                        || uri.getPort() > 65535) {
                    throw new IllegalArgumentException();
                }
            } catch (IllegalArgumentException exception) {
                throw new IllegalStateException("CORS_ALLOWED_ORIGINS must contain explicit HTTP(S) origins only.");
            }
        }
        return origins;
    }
}

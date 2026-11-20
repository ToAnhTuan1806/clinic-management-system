package com.clinicmanagement.service;

import com.clinicmanagement.exception.ManagementException;
import java.util.Locale;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;

final class CatalogQueries {
    private CatalogQueries() { }

    static PageRequest page(int page, int size, String property) {
        if (page < 0 || size < 1 || size > 100) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Invalid pagination.");
        }
        return PageRequest.of(page, size, Sort.by(property).ascending().and(Sort.by("id")));
    }

    static String search(String search) {
        String value = search == null ? "" : search.trim();
        if (value.length() > 120) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Search is too long.");
        }
        return value.toLowerCase(Locale.ROOT);
    }

    static String like(String search) {
        return "%" + search(search).replace("\\", "\\\\").replace("%", "\\%")
                .replace("_", "\\_") + "%";
    }
}

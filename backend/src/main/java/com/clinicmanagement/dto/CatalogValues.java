package com.clinicmanagement.dto;

import java.util.Locale;

public final class CatalogValues {
    public static final String CODE_PATTERN = "[A-Z0-9][A-Z0-9_-]{0,31}";
    private CatalogValues() { }
    public static String trim(String value) { return value == null ? null : value.trim(); }
    public static String code(String value) { return value == null ? null : value.trim().toUpperCase(Locale.ROOT); }
    public static String optionalText(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}

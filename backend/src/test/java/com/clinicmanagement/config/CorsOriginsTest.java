package com.clinicmanagement.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class CorsOriginsTest {
    @Test
    void emptyClosesCrossOriginAccessAndExplicitOriginsAreTrimmed() {
        assertThat(CorsOrigins.parse("")).isEmpty();
        assertThat(CorsOrigins.parse(" http://localhost:5173,https://fe.example.invalid,http://localhost:5173 "))
                .containsExactly("http://localhost:5173", "https://fe.example.invalid");
    }

    @ParameterizedTest
    @ValueSource(strings = {"*", "null", "https://*.example.invalid", "https://host.invalid/path", "https://host.invalid/",
            "ftp://host.invalid", "https://user@host.invalid", "https://host.invalid?x=1", "https://host.invalid#fragment", ","})
    void rejectsWildcardOrNonOriginConfiguration(String origin) {
        assertThrows(IllegalStateException.class, () -> CorsOrigins.parse(origin));
    }
}

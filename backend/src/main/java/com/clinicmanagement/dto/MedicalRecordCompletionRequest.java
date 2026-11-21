package com.clinicmanagement.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.annotation.JsonDeserialize;

public record MedicalRecordCompletionRequest(
        @JsonDeserialize(using = MedicalRecordCompletionRequest.VersionDeserializer.class)
        @NotNull @PositiveOrZero Long expectedVersion) {

    // Jackson normally coerces floating point values and strings into integers.
    public static class VersionDeserializer extends ValueDeserializer<Long> {
        @Override
        public Long deserialize(JsonParser parser, DeserializationContext context) {
            if (!parser.hasToken(JsonToken.VALUE_NUMBER_INT)) {
                return context.reportInputMismatch(Long.class, "Expected an integer version.");
            }
            return parser.getLongValue();
        }
    }
}

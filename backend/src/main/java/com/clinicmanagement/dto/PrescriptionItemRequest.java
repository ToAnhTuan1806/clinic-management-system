package com.clinicmanagement.dto;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record PrescriptionItemRequest(
        @NotBlank @Size(max = 200) @JsonDeserialize(using = TextDeserializer.class) String medicationName,
        @NotNull @Min(1) @Max(10000) @JsonDeserialize(using = IntegerDeserializer.class) Integer quantity,
        @NotBlank @Size(max = 100) @JsonDeserialize(using = TextDeserializer.class) String dosage,
        @NotBlank @Size(max = 100) @JsonDeserialize(using = TextDeserializer.class) String frequency,
        @NotNull @Min(1) @Max(365) @JsonDeserialize(using = IntegerDeserializer.class) Integer durationDays,
        @Size(max = 1000) @JsonDeserialize(using = TextDeserializer.class) String instructions
) {
    public PrescriptionItemRequest {
        medicationName = medicationName != null ? medicationName.strip() : null;
        dosage = dosage != null ? dosage.strip() : null;
        frequency = frequency != null ? frequency.strip() : null;
        instructions = instructions != null ? (instructions.isBlank() ? null : instructions.strip()) : null;
    }
    // JSON types are part of the prescription contract: do not silently coerce values.
    public static class IntegerDeserializer extends ValueDeserializer<Integer> {
        @Override
        public Integer deserialize(JsonParser parser, DeserializationContext context) {
            if (!parser.hasToken(JsonToken.VALUE_NUMBER_INT)) {
                return context.reportInputMismatch(Integer.class, "Expected an integer.");
            }
            return parser.getIntValue();
        }
    }

    public static class TextDeserializer extends ValueDeserializer<String> {
        @Override
        public String deserialize(JsonParser parser, DeserializationContext context) {
            if (!parser.hasToken(JsonToken.VALUE_STRING)) {
                return context.reportInputMismatch(String.class, "Expected a string.");
            }
            return parser.getString();
        }
    }
}


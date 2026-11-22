package com.clinicmanagement.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.ArrayList;
import java.util.Collections;
import tools.jackson.databind.annotation.JsonDeserialize;

public record PrescriptionPutRequest(
        @JsonDeserialize(using = MedicalRecordCompletionRequest.VersionDeserializer.class)
        @NotNull @Min(0) Long expectedVersion,
        @Valid @NotNull @Size(max = 50) List<@NotNull @Valid PrescriptionItemRequest> items
) {
    public PrescriptionPutRequest {
        items = items != null ? Collections.unmodifiableList(new ArrayList<>(items)) : null;
    }
}

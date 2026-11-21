package com.clinicmanagement.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

public record MedicalRecordCreateRequest(@NotNull @Positive Long appointmentId) {}

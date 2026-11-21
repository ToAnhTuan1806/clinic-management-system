package com.clinicmanagement.dto;

import java.time.Instant;

public record MedicalHistoryItem(String id, String appointmentId, String doctorId, Instant completedAt,
                                 Instant releasedAt, long version) {}

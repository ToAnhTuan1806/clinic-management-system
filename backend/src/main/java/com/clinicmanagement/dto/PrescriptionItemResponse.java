package com.clinicmanagement.dto;

import com.clinicmanagement.entity.PrescriptionItem;

public record PrescriptionItemResponse(
        String id,
        String medicationName,
        Integer quantity,
        String dosage,
        String frequency,
        Integer durationDays,
        String instructions
) {
    public static PrescriptionItemResponse from(PrescriptionItem item) {
        return new PrescriptionItemResponse(
                item.getId() != null ? item.getId().toString() : null,
                item.getMedicationName(),
                item.getQuantity(),
                item.getDosage(),
                item.getFrequency(),
                item.getDurationDays(),
                item.getInstructions()
        );
    }
}

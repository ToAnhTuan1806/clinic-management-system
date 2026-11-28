package com.clinicmanagement.dto;

import com.clinicmanagement.entity.Prescription;
import java.util.List;

public record PrescriptionResponse(
        String id,
        String medicalRecordId,
        Long recordVersion,
        boolean editable,
        boolean simulation,
        List<PrescriptionItemResponse> items
) {
    public static PrescriptionResponse empty(Long medicalRecordId, Long recordVersion, boolean editable) {
        return new PrescriptionResponse(
                null,
                medicalRecordId.toString(),
                recordVersion,
                editable,
                true,
                List.of()
        );
    }

    public static PrescriptionResponse from(Prescription prescription, Long recordVersion, boolean editable) {
        List<PrescriptionItemResponse> itemResponses = prescription.getItems().stream()
                .map(PrescriptionItemResponse::from)
                .toList();
        return new PrescriptionResponse(
                prescription.getId() != null ? prescription.getId().toString() : null,
                prescription.getMedicalRecord().getId().toString(),
                recordVersion,
                editable,
                true,
                itemResponses
        );
    }
}

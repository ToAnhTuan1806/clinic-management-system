package com.clinicmanagement.dto;

import com.clinicmanagement.entity.AppointmentStatus;
import com.clinicmanagement.entity.MedicalRecord;
import com.fasterxml.jackson.annotation.JsonUnwrapped;
import java.time.Instant;

public sealed interface MedicalRecordView {
    record Metadata(String id, String appointmentId, String doctorId, String patientId, AppointmentStatus status,
                    String createdBy, String completedBy, Instant completedAt, Instant createdAt, Instant updatedAt,
                    long version) implements MedicalRecordView {
        public static Metadata from(MedicalRecord record) {
            var appointment = record.getAppointment();
            return new Metadata(record.getId().toString(), appointment.getId().toString(),
                    appointment.getDoctor().getId().toString(), appointment.getPatient().getId().toString(),
                    appointment.getStatus(), record.getCreatedBy().getId().toString(),
                    record.getCompletedBy() == null ? null : record.getCompletedBy().getId().toString(),
                    record.getCompletedAt(), record.getCreatedAt(), record.getUpdatedAt(), record.getVersion());
        }
    }

    record Clinical(@JsonUnwrapped Metadata metadata, String symptoms, String diagnosis, String notes,
                    String conclusion) implements MedicalRecordView {
        public static Clinical from(MedicalRecord record) {
            return new Clinical(Metadata.from(record), record.getSymptoms(), record.getDiagnosis(),
                    record.getNotes(), record.getConclusion());
        }

        @Override
        public String toString() {
            return "MedicalRecordView.Clinical[clinical fields redacted]";
        }
    }
}

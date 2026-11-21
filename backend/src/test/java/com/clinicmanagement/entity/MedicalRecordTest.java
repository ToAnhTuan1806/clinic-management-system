package com.clinicmanagement.entity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class MedicalRecordTest {
    @Test
    void completionRequiresAllThreeNonblankFieldsAndPatchPreservesOmittedFields() {
        Instant now = Instant.parse("2026-11-22T00:00:00Z");
        User doctor = mock(User.class);
        var record = new MedicalRecord(mock(Appointment.class), doctor, now);

        record.update(" Synthetic symptom ", "Synthetic diagnosis", null, null, now);
        assertThat(record.hasRequiredContent()).isFalse();
        record.update(null, null, null, "Synthetic conclusion", now);
        assertThat(record.hasRequiredContent()).isTrue();
        assertThat(record.getSymptoms()).isEqualTo("Synthetic symptom");
        record.update(null, "  ", null, null, now);
        assertThat(record.hasRequiredContent()).isFalse();
    }

    @Test
    void appointmentCannotSkipCheckInOrRepeatCompletion() {
        var appointment = new Appointment();
        assertThatThrownBy(appointment::startExamination).isInstanceOf(IllegalStateException.class);
        appointment.checkIn(mock(User.class));
        assertThatThrownBy(appointment::completeExamination).isInstanceOf(IllegalStateException.class);
        appointment.startExamination();
        appointment.completeExamination();
        assertThatThrownBy(appointment::completeExamination).isInstanceOf(IllegalStateException.class);
    }
}

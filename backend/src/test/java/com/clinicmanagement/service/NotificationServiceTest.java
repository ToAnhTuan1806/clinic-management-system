package com.clinicmanagement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.clinicmanagement.entity.*;
import com.clinicmanagement.repository.NotificationRepository;
import com.clinicmanagement.repository.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

class NotificationServiceTest {
    private User user(long id, Role role) {
        User user = User.registerPatient("user" + id + "@example.invalid", "unused-test-hash", "Synthetic User");
        ReflectionTestUtils.setField(user, "id", id);
        ReflectionTestUtils.setField(user, "role", role);
        return user;
    }

    private Appointment appointment(User patientUser, User doctorUser) {
        var doctor = new Doctor(doctorUser, new Specialty("TEST", "Synthetic", null, true), "D13", null, null, true);
        var patient = new Patient(patientUser, "D13", "Synthetic Patient", null, null, null, null, true);
        Instant start = Instant.parse("2026-11-22T01:00:00Z");
        var appointment = new Appointment("D13-TEST", patient, doctor, null, patientUser,
                "request", "a".repeat(64), start, start.plusSeconds(1800), AppointmentStatus.PENDING, "Synthetic private reason");
        ReflectionTestUtils.setField(appointment, "id", 77L);
        ReflectionTestUtils.setField(appointment, "version", 4L);
        return appointment;
    }

    @Test
    void rescheduleNotifiesPatientAndBothDoctorsWithoutDuplicateRecipients() {
        var repository = mock(NotificationRepository.class);
        var users = mock(UserRepository.class);
        var service = new NotificationService(repository, users,
                Clock.fixed(Instant.parse("2026-11-22T00:00:00Z"), ZoneOffset.UTC));
        User patient = user(1, Role.PATIENT);
        User currentDoctor = user(2, Role.DOCTOR);
        User previousDoctor = user(3, Role.DOCTOR);
        when(users.findActiveNotificationRecipients(any())).thenReturn(List.of(patient, currentDoctor, previousDoctor));
        service.appointmentChanged(appointment(patient, currentDoctor), NotificationType.APPOINTMENT_RESCHEDULED, previousDoctor);
        verify(users).findActiveNotificationRecipients(Set.of(1L, 2L, 3L));
        var captured = ArgumentCaptor.forClass(Notification.class);
        verify(repository, times(3)).save(captured.capture());
        assertThat(captured.getAllValues().stream().map(n -> n.getBody().contains("private")).toList())
                .containsOnly(false);
        verify(repository).flush();
    }

    @Test
    void overlappingRecipientAndPreviousDoctorOnlyProduceOneNotification() {
        var repository = mock(NotificationRepository.class);
        var users = mock(UserRepository.class);
        var service = new NotificationService(repository, users, Clock.systemUTC());
        User doctor = user(2, Role.DOCTOR);
        when(users.findActiveNotificationRecipients(Set.of(2L))).thenReturn(List.of(doctor));
        service.appointmentChanged(appointment(doctor, doctor), NotificationType.APPOINTMENT_RESCHEDULED, doctor);
        verify(repository).save(any(Notification.class));
        verify(users).findActiveNotificationRecipients(Set.of(2L));
    }
}

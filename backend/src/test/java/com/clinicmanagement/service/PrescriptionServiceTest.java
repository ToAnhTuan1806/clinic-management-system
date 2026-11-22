package com.clinicmanagement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.clinicmanagement.dto.PrescriptionItemRequest;
import com.clinicmanagement.dto.PrescriptionPutRequest;
import com.clinicmanagement.dto.PrescriptionResponse;
import com.clinicmanagement.entity.*;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.AppointmentRepository;
import com.clinicmanagement.repository.MedicalRecordRepository;
import com.clinicmanagement.repository.PrescriptionRepository;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

class PrescriptionServiceTest {
    private final PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
    private final MedicalRecordRepository recordRepository = mock(MedicalRecordRepository.class);
    private final AppointmentRepository appointmentRepository = mock(AppointmentRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-22T10:00:00Z"), ZoneOffset.UTC);
    private final EntityManager entityManager = mock(EntityManager.class);

    private final PrescriptionService service = new PrescriptionService(
            prescriptionRepository, recordRepository, appointmentRepository, userRepository, clock, entityManager);

    private User doctorUser;
    private User secondDoctorUser;
    private User patientUser;
    private User otherPatientUser;
    private User adminUser;
    private Doctor doctor;
    private Patient patient;
    private Appointment appointment;
    private MedicalRecord record;

    @BeforeEach
    void setUp() {
        doctorUser = User.registerPatient("doctor@clinic.test", "hash", "Dr. Test");
        ReflectionTestUtils.setField(doctorUser, "id", 101L);
        ReflectionTestUtils.setField(doctorUser, "role", Role.DOCTOR);
        ReflectionTestUtils.setField(doctorUser, "status", UserStatus.ACTIVE);

        secondDoctorUser = User.registerPatient("doctor2@clinic.test", "hash", "Dr. Other");
        ReflectionTestUtils.setField(secondDoctorUser, "id", 102L);
        ReflectionTestUtils.setField(secondDoctorUser, "role", Role.DOCTOR);
        ReflectionTestUtils.setField(secondDoctorUser, "status", UserStatus.ACTIVE);

        patientUser = User.registerPatient("patient@clinic.test", "hash", "Patient Test");
        ReflectionTestUtils.setField(patientUser, "id", 201L);
        ReflectionTestUtils.setField(patientUser, "role", Role.PATIENT);
        ReflectionTestUtils.setField(patientUser, "status", UserStatus.ACTIVE);

        otherPatientUser = User.registerPatient("patient2@clinic.test", "hash", "Patient Other");
        ReflectionTestUtils.setField(otherPatientUser, "id", 202L);
        ReflectionTestUtils.setField(otherPatientUser, "role", Role.PATIENT);
        ReflectionTestUtils.setField(otherPatientUser, "status", UserStatus.ACTIVE);

        adminUser = User.registerPatient("admin@clinic.test", "hash", "Admin");
        ReflectionTestUtils.setField(adminUser, "id", 301L);
        ReflectionTestUtils.setField(adminUser, "role", Role.ADMIN);
        ReflectionTestUtils.setField(adminUser, "status", UserStatus.ACTIVE);

        Specialty specialty = new Specialty("GEN", "General", "Desc", true);
        doctor = new Doctor(doctorUser, specialty, "DOC001", "LIC001", "Bio", true);
        ReflectionTestUtils.setField(doctor, "id", 501L);

        patient = new Patient(patientUser, "PAT001", "Patient Test", java.time.LocalDate.of(1990, 1, 1),
                Sex.MALE, "0901234567", "Hanoi", true);
        ReflectionTestUtils.setField(patient, "id", 601L);

        DoctorSchedule schedule = new DoctorSchedule(doctor, java.time.LocalDate.of(2026, 11, 22),
                Instant.parse("2026-11-22T08:00:00Z"), Instant.parse("2026-11-22T12:00:00Z"), 30, ScheduleStatus.ACTIVE);
        ReflectionTestUtils.setField(schedule, "id", 701L);

        appointment = new Appointment("APP001", patient, doctor, schedule, doctorUser, "req-1", "fp-1",
                Instant.parse("2026-11-22T09:00:00Z"), Instant.parse("2026-11-22T09:30:00Z"),
                AppointmentStatus.IN_PROGRESS, null);
        ReflectionTestUtils.setField(appointment, "id", 801L);

        record = new MedicalRecord(appointment, doctorUser, clock.instant());
        ReflectionTestUtils.setField(record, "id", 901L);
        ReflectionTestUtils.setField(record, "version", 0L);
    }

    @Test
    void get_RecordNotFound_Throws404() {
        when(recordRepository.findById(999L)).thenReturn(Optional.empty());
        AuthenticatedUser viewer = new AuthenticatedUser(101L, "doctor@clinic.test", "Dr. Test", Role.DOCTOR, UserStatus.ACTIVE);

        ManagementException ex = assertThrows(ManagementException.class, () -> service.get(viewer, 999L));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void get_DoctorNotAssigned_Throws404() {
        when(recordRepository.findById(901L)).thenReturn(Optional.of(record));
        AuthenticatedUser viewer = new AuthenticatedUser(102L, "doctor2@clinic.test", "Dr. Other", Role.DOCTOR, UserStatus.ACTIVE);

        ManagementException ex = assertThrows(ManagementException.class, () -> service.get(viewer, 901L));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void get_DoctorAssigned_NoPrescription_ReturnsEmptyPrescription() {
        when(recordRepository.findById(901L)).thenReturn(Optional.of(record));
        when(prescriptionRepository.findByMedicalRecordId(901L)).thenReturn(Optional.empty());
        AuthenticatedUser viewer = new AuthenticatedUser(101L, "doctor@clinic.test", "Dr. Test", Role.DOCTOR, UserStatus.ACTIVE);

        PrescriptionResponse response = service.get(viewer, 901L);
        assertThat(response.id()).isNull();
        assertThat(response.medicalRecordId()).isEqualTo("901");
        assertThat(response.recordVersion()).isEqualTo(0L);
        assertThat(response.editable()).isTrue();
        assertThat(response.simulation()).isTrue();
        assertThat(response.items()).isEmpty();
    }

    @Test
    void get_DoctorAssigned_WithPrescription_ReturnsPrescription() {
        Prescription prescription = new Prescription(record, doctorUser, clock.instant());
        ReflectionTestUtils.setField(prescription, "id", 1001L);
        PrescriptionItem item = new PrescriptionItem("Paracetamol 500mg", 10, "1 vien", "2 lan/ngay", 5, "Uong sau an", 0);
        ReflectionTestUtils.setField(item, "id", 2001L);
        prescription.addItem(item);

        when(recordRepository.findById(901L)).thenReturn(Optional.of(record));
        when(prescriptionRepository.findByMedicalRecordId(901L)).thenReturn(Optional.of(prescription));
        AuthenticatedUser viewer = new AuthenticatedUser(101L, "doctor@clinic.test", "Dr. Test", Role.DOCTOR, UserStatus.ACTIVE);

        PrescriptionResponse response = service.get(viewer, 901L);
        assertThat(response.id()).isEqualTo("1001");
        assertThat(response.medicalRecordId()).isEqualTo("901");
        assertThat(response.recordVersion()).isEqualTo(0L);
        assertThat(response.editable()).isTrue();
        assertThat(response.simulation()).isTrue();
        assertThat(response.items()).hasSize(1);
        assertThat(response.items().get(0).id()).isEqualTo("2001");
        assertThat(response.items().get(0).medicationName()).isEqualTo("Paracetamol 500mg");
    }

    @Test
    void get_Patient_RecordNotCompleted_Throws404() {
        when(recordRepository.findById(901L)).thenReturn(Optional.of(record));
        AuthenticatedUser viewer = new AuthenticatedUser(201L, "patient@clinic.test", "Patient Test", Role.PATIENT, UserStatus.ACTIVE);

        ManagementException ex = assertThrows(ManagementException.class, () -> service.get(viewer, 901L));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void get_Patient_RecordCompletedButNotReleased_Throws404() {
        ReflectionTestUtils.setField(appointment, "status", AppointmentStatus.COMPLETED);
        record.complete(doctorUser, clock.instant());
        when(recordRepository.findById(901L)).thenReturn(Optional.of(record));
        AuthenticatedUser viewer = new AuthenticatedUser(201L, "patient@clinic.test", "Patient Test", Role.PATIENT, UserStatus.ACTIVE);

        ManagementException ex = assertThrows(ManagementException.class, () -> service.get(viewer, 901L));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void get_Patient_CompletedAndReleased_ReturnsPrescriptionWithEditableFalse() {
        ReflectionTestUtils.setField(appointment, "status", AppointmentStatus.COMPLETED);
        record.complete(doctorUser, clock.instant());
        record.release(doctorUser, clock.instant());

        Prescription prescription = new Prescription(record, doctorUser, clock.instant());
        ReflectionTestUtils.setField(prescription, "id", 1001L);
        PrescriptionItem item = new PrescriptionItem("Amoxicillin 500mg", 14, "1 vien", "2 lan/ngay", 7, "Uong dung gio", 0);
        ReflectionTestUtils.setField(item, "id", 2002L);
        prescription.addItem(item);

        when(recordRepository.findById(901L)).thenReturn(Optional.of(record));
        when(prescriptionRepository.findByMedicalRecordId(901L)).thenReturn(Optional.of(prescription));
        AuthenticatedUser viewer = new AuthenticatedUser(201L, "patient@clinic.test", "Patient Test", Role.PATIENT, UserStatus.ACTIVE);

        PrescriptionResponse response = service.get(viewer, 901L);
        assertThat(response.id()).isEqualTo("1001");
        assertThat(response.editable()).isFalse();
        assertThat(response.simulation()).isTrue();
        assertThat(response.items()).hasSize(1);
    }

    @Test
    void get_OtherPatient_Throws404() {
        ReflectionTestUtils.setField(appointment, "status", AppointmentStatus.COMPLETED);
        record.complete(doctorUser, clock.instant());
        record.release(doctorUser, clock.instant());

        when(recordRepository.findById(901L)).thenReturn(Optional.of(record));
        AuthenticatedUser viewer = new AuthenticatedUser(202L, "patient2@clinic.test", "Patient Other", Role.PATIENT, UserStatus.ACTIVE);

        ManagementException ex = assertThrows(ManagementException.class, () -> service.get(viewer, 901L));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void put_DoctorNotAssigned_Throws404() {
        when(recordRepository.findAppointmentId(901L)).thenReturn(Optional.of(801L));
        when(appointmentRepository.findLockedForExamination(801L)).thenReturn(Optional.of(appointment));

        AuthenticatedUser viewer = new AuthenticatedUser(102L, "doctor2@clinic.test", "Dr. Other", Role.DOCTOR, UserStatus.ACTIVE);
        PrescriptionPutRequest request = new PrescriptionPutRequest(0L, List.of());

        ManagementException ex = assertThrows(ManagementException.class, () -> service.put(viewer, 901L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void put_AppointmentNotInProgress_Throws409() {
        ReflectionTestUtils.setField(appointment, "status", AppointmentStatus.CHECKED_IN);
        when(recordRepository.findAppointmentId(901L)).thenReturn(Optional.of(801L));
        when(appointmentRepository.findLockedForExamination(801L)).thenReturn(Optional.of(appointment));

        AuthenticatedUser viewer = new AuthenticatedUser(101L, "doctor@clinic.test", "Dr. Test", Role.DOCTOR, UserStatus.ACTIVE);
        PrescriptionPutRequest request = new PrescriptionPutRequest(0L, List.of());

        ManagementException ex = assertThrows(ManagementException.class, () -> service.put(viewer, 901L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    void put_RecordCompleted_Throws409() {
        record.complete(doctorUser, clock.instant());
        when(recordRepository.findAppointmentId(901L)).thenReturn(Optional.of(801L));
        when(appointmentRepository.findLockedForExamination(801L)).thenReturn(Optional.of(appointment));
        when(recordRepository.findLocked(901L)).thenReturn(Optional.of(record));

        AuthenticatedUser viewer = new AuthenticatedUser(101L, "doctor@clinic.test", "Dr. Test", Role.DOCTOR, UserStatus.ACTIVE);
        PrescriptionPutRequest request = new PrescriptionPutRequest(0L, List.of());

        ManagementException ex = assertThrows(ManagementException.class, () -> service.put(viewer, 901L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    void put_VersionMismatch_Throws409() {
        when(recordRepository.findAppointmentId(901L)).thenReturn(Optional.of(801L));
        when(appointmentRepository.findLockedForExamination(801L)).thenReturn(Optional.of(appointment));
        when(recordRepository.findLocked(901L)).thenReturn(Optional.of(record));

        AuthenticatedUser viewer = new AuthenticatedUser(101L, "doctor@clinic.test", "Dr. Test", Role.DOCTOR, UserStatus.ACTIVE);
        PrescriptionPutRequest request = new PrescriptionPutRequest(5L, List.of()); // Expected 5, actual 0

        ManagementException ex = assertThrows(ManagementException.class, () -> service.put(viewer, 901L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("VERSION_CONFLICT");
    }

    @Test
    void put_ValidItems_SavesAndIncrementsRecordVersion() {
        when(recordRepository.findAppointmentId(901L)).thenReturn(Optional.of(801L));
        when(appointmentRepository.findLockedForExamination(801L)).thenReturn(Optional.of(appointment));
        when(recordRepository.findLocked(901L)).thenReturn(Optional.of(record));
        when(prescriptionRepository.findByMedicalRecordId(901L)).thenReturn(Optional.empty());
        when(userRepository.getReferenceById(101L)).thenReturn(doctorUser);

        when(prescriptionRepository.save(any(Prescription.class))).thenAnswer(invocation -> {
            Prescription p = invocation.getArgument(0);
            ReflectionTestUtils.setField(p, "id", 1001L);
            long itemId = 2001L;
            for (PrescriptionItem item : p.getItems()) {
                ReflectionTestUtils.setField(item, "id", itemId++);
            }
            return p;
        });

        AuthenticatedUser viewer = new AuthenticatedUser(101L, "doctor@clinic.test", "Dr. Test", Role.DOCTOR, UserStatus.ACTIVE);
        PrescriptionItemRequest item1 = new PrescriptionItemRequest("  Thuoc A  ", 10, "  1 vien  ", "  2 lan/ngay  ", 5, "  Uong sau an  ");
        PrescriptionItemRequest item2 = new PrescriptionItemRequest("Thuoc B", 20, "2 vien", "1 lan/ngay", 10, null);
        PrescriptionPutRequest request = new PrescriptionPutRequest(0L, List.of(item1, item2));

        PrescriptionResponse response = service.put(viewer, 901L, request);
        assertThat(response.id()).isEqualTo("1001");
        assertThat(response.medicalRecordId()).isEqualTo("901");
        assertThat(response.editable()).isTrue();
        assertThat(response.simulation()).isTrue();
        assertThat(response.items()).hasSize(2);

        // Verification of item trimming and ordering
        assertThat(response.items().get(0).medicationName()).isEqualTo("Thuoc A");
        assertThat(response.items().get(0).dosage()).isEqualTo("1 vien");
        assertThat(response.items().get(0).frequency()).isEqualTo("2 lan/ngay");
        assertThat(response.items().get(0).instructions()).isEqualTo("Uong sau an");
        assertThat(response.items().get(1).medicationName()).isEqualTo("Thuoc B");

        verify(prescriptionRepository).save(any(Prescription.class));
        verify(prescriptionRepository).flush();
        verify(recordRepository).flush();
    }

    @Test
    void put_EmptyItems_ClearsPrescriptionItems() {
        Prescription existing = new Prescription(record, doctorUser, clock.instant());
        ReflectionTestUtils.setField(existing, "id", 1001L);
        existing.addItem(new PrescriptionItem("Old Med", 5, "1 vien", "1 lan", 3, null, 0));

        when(recordRepository.findAppointmentId(901L)).thenReturn(Optional.of(801L));
        when(appointmentRepository.findLockedForExamination(801L)).thenReturn(Optional.of(appointment));
        when(recordRepository.findLocked(901L)).thenReturn(Optional.of(record));
        when(prescriptionRepository.findByMedicalRecordId(901L)).thenReturn(Optional.of(existing));
        when(prescriptionRepository.save(any(Prescription.class))).thenAnswer(i -> i.getArgument(0));

        AuthenticatedUser viewer = new AuthenticatedUser(101L, "doctor@clinic.test", "Dr. Test", Role.DOCTOR, UserStatus.ACTIVE);
        PrescriptionPutRequest request = new PrescriptionPutRequest(0L, List.of());

        PrescriptionResponse response = service.put(viewer, 901L, request);
        assertThat(response.id()).isEqualTo("1001");
        assertThat(response.items()).isEmpty();
        assertThat(existing.getItems()).isEmpty();
    }
}

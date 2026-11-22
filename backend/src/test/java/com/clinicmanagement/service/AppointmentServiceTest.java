package com.clinicmanagement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.clinicmanagement.dto.AppointmentBookRequest;
import com.clinicmanagement.dto.AppointmentBookingResult;
import com.clinicmanagement.dto.AppointmentResponse;
import com.clinicmanagement.dto.PageResponse;
import com.clinicmanagement.entity.*;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.*;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

class AppointmentServiceTest {
    private final AppointmentRepository appointmentRepository = mock(AppointmentRepository.class);
    private final DoctorScheduleRepository scheduleRepository = mock(DoctorScheduleRepository.class);
    private final DoctorRepository doctorRepository = mock(DoctorRepository.class);
    private final PatientRepository patientRepository = mock(PatientRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final jakarta.persistence.EntityManager entityManager = mock(jakarta.persistence.EntityManager.class);

    private final AppointmentService service = new AppointmentService(
            appointmentRepository, scheduleRepository, doctorRepository, patientRepository, userRepository, entityManager,
            mock(NotificationService.class));

    private User patientUser;
    private Patient patient;
    private User doctorUser;
    private Specialty specialty;
    private Doctor doctor;
    private DoctorSchedule schedule;

    private AuthenticatedUser patientAuth;
    private AuthenticatedUser receptionistAuth;
    private AuthenticatedUser doctorAuth;

    @BeforeEach
    void setUp() {
        patientUser = User.registerPatient("patient@clinic.test", "hash", "Patient Test");
        ReflectionTestUtils.setField(patientUser, "id", 1L);
        ReflectionTestUtils.setField(patientUser, "status", UserStatus.ACTIVE);

        patient = new Patient(patientUser, "PAT000001", "Patient Test", LocalDate.of(1995, 1, 1),
                Sex.MALE, "0901112222", "Hanoi", true);
        ReflectionTestUtils.setField(patient, "id", 10L);

        doctorUser = User.registerPatient("doctor@clinic.test", "hash", "Dr. Nguyen");
        ReflectionTestUtils.setField(doctorUser, "id", 2L);
        ReflectionTestUtils.setField(doctorUser, "role", Role.DOCTOR);
        ReflectionTestUtils.setField(doctorUser, "status", UserStatus.ACTIVE);

        specialty = new Specialty("GEN", "General", "Desc", true);
        ReflectionTestUtils.setField(specialty, "id", 100L);

        doctor = new Doctor(doctorUser, specialty, "DOC001", "LIC001", "Bio", true);
        ReflectionTestUtils.setField(doctor, "id", 20L);

        Instant start = futureTime(2, 8, 0);
        Instant end = futureTime(2, 12, 0);
        LocalDate workDate = start.atZone(DoctorScheduleService.ZONE_VN).toLocalDate();
        schedule = new DoctorSchedule(doctor, workDate, start, end, 30, ScheduleStatus.ACTIVE);
        ReflectionTestUtils.setField(schedule, "id", 300L);

        patientAuth = new AuthenticatedUser(1L, "patient@clinic.test", "Patient Test", Role.PATIENT, UserStatus.ACTIVE);
        receptionistAuth = new AuthenticatedUser(3L, "receptionist@clinic.test", "Receptionist", Role.RECEPTIONIST, UserStatus.ACTIVE);
        doctorAuth = new AuthenticatedUser(2L, "doctor@clinic.test", "Dr. Nguyen", Role.DOCTOR, UserStatus.ACTIVE);

        when(userRepository.findById(1L)).thenReturn(Optional.of(patientUser));
        User recUser = User.registerPatient("rec@clinic.test", "hash", "Rec");
        ReflectionTestUtils.setField(recUser, "id", 3L);
        when(userRepository.findById(3L)).thenReturn(Optional.of(recUser));
        when(doctorRepository.findLocked(20L)).thenReturn(Optional.of(doctor));
    }

    private Instant futureTime(int plusDays, int hour, int minute) {
        LocalDate targetDate = LocalDate.now(DoctorScheduleService.ZONE_VN).plusDays(plusDays);
        ZonedDateTime vnTime = targetDate.atTime(hour, minute).atZone(DoctorScheduleService.ZONE_VN);
        return vnTime.toInstant();
    }

    @Test
    void bookAppointmentSuccessForPatient() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));
        when(appointmentRepository.existsByDoctorIdAndStartAtAndStatusNot(eq(20L), any(), any())).thenReturn(false);
        when(appointmentRepository.saveAndFlush(any())).thenAnswer(invocation -> {
            Appointment a = invocation.getArgument(0);
            ReflectionTestUtils.setField(a, "id", 500L);
            return a;
        });

        Instant slotStart = futureTime(2, 8, 30);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-1", "Health check", null);

        AppointmentBookingResult result = service.bookAppointment(patientAuth, request);

        assertThat(result.replayed()).isFalse();
        assertThat(result.appointment().id()).isEqualTo("500");
        assertThat(result.appointment().patientId()).isEqualTo("10");
        assertThat(result.appointment().doctorId()).isEqualTo("20");
        assertThat(result.appointment().startAt()).isEqualTo(slotStart);
        assertThat(result.appointment().endAt()).isEqualTo(slotStart.plus(Duration.ofMinutes(30)));
        assertThat(result.appointment().status()).isEqualTo("PENDING");
    }

    @Test
    void bookAppointmentSuccessForReceptionist() {
        when(patientRepository.findById(10L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));
        when(appointmentRepository.existsByDoctorIdAndStartAtAndStatusNot(eq(20L), any(), any())).thenReturn(false);
        when(appointmentRepository.saveAndFlush(any())).thenAnswer(invocation -> {
            Appointment a = invocation.getArgument(0);
            ReflectionTestUtils.setField(a, "id", 501L);
            return a;
        });

        Instant slotStart = futureTime(2, 9, 0);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-2", "Walk-in check", "10");

        AppointmentBookingResult result = service.bookAppointment(receptionistAuth, request);

        assertThat(result.replayed()).isFalse();
        assertThat(result.appointment().id()).isEqualTo("501");
        assertThat(result.appointment().patientId()).isEqualTo("10");
    }

    @Test
    void bookAppointmentFailsIfPatientSpecifiesPatientId() {
        Instant slotStart = futureTime(2, 8, 30);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-3", "Reason", "10");

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(ex.getCode()).isEqualTo("ACCESS_DENIED");
    }

    @Test
    void bookAppointmentFailsIfReceptionistOmitsPatientId() {
        Instant slotStart = futureTime(2, 8, 30);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-4", "Reason", null);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(receptionistAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void bookAppointmentFailsIfPatientHasNoLinkedProfile() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.empty());
        Instant slotStart = futureTime(2, 8, 30);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-5", "Reason", null);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(ex.getCode()).isEqualTo("RESOURCE_NOT_FOUND");
    }

    @Test
    void bookAppointmentFailsIfPatientInactive() {
        ReflectionTestUtils.setField(patient, "active", false);
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));

        Instant slotStart = futureTime(2, 8, 30);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-6", "Reason", null);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("PATIENT_INACTIVE");
    }

    @Test
    void bookAppointmentFailsIfScheduleBlocked() {
        ReflectionTestUtils.setField(schedule, "status", ScheduleStatus.BLOCKED);
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));

        Instant slotStart = futureTime(2, 8, 30);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-7", "Reason", null);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("SCHEDULE_BLOCKED");
    }

    @Test
    void bookAppointmentFailsIfDoctorInactive() {
        ReflectionTestUtils.setField(doctor, "active", false);
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));

        Instant slotStart = futureTime(2, 8, 30);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-8", "Reason", null);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("DOCTOR_INACTIVE");
    }

    @Test
    void bookAppointmentFailsIfDoctorUserDisabled() {
        ReflectionTestUtils.setField(doctorUser, "status", UserStatus.DISABLED);
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));

        Instant slotStart = futureTime(2, 8, 30);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-9", "Reason", null);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("USER_NOT_ACTIVE");
    }

    @Test
    void bookAppointmentFailsIfStartAtInPast() {
        Instant past = Instant.now().minus(Duration.ofHours(1));
        AppointmentBookRequest request = new AppointmentBookRequest("300", past, "req-10", "Reason", null);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void bookAppointmentFailsIfStartAtOutsideScheduleHours() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));

        // Schedule is 8:00 to 12:00; test 7:30 and 12:00
        Instant early = futureTime(2, 7, 30);
        AppointmentBookRequest requestEarly = new AppointmentBookRequest("300", early, "req-11a", "Reason", null);
        ManagementException exEarly = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, requestEarly));
        assertThat(exEarly.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);

        Instant late = futureTime(2, 12, 0); // 30 min duration means ends at 12:30 which exceeds 12:00
        AppointmentBookRequest requestLate = new AppointmentBookRequest("300", late, "req-11b", "Reason", null);
        ManagementException exLate = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, requestLate));
        assertThat(exLate.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void bookAppointmentFailsIfStartAtNotAlignedWithSlotGrid() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));

        // Schedule is 8:00, slot is 30 mins. 8:15 is misaligned!
        Instant misaligned = futureTime(2, 8, 15);
        AppointmentBookRequest request = new AppointmentBookRequest("300", misaligned, "req-12", "Reason", null);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getMessage()).contains("align with the schedule slot grid");
    }

    @Test
    void bookAppointmentFailsIfSlotAlreadyBooked() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));
        when(appointmentRepository.existsByDoctorIdAndStartAtAndStatusNot(eq(20L), any(), any())).thenReturn(true);

        Instant slotStart = futureTime(2, 8, 30);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-13", "Reason", null);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("SLOT_ALREADY_BOOKED");
    }

    @Test
    void bookAppointmentIdempotencyReplaySameKeySamePayload() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));

        Instant slotStart = futureTime(2, 8, 30);
        Instant slotEnd = slotStart.plus(Duration.ofMinutes(30));

        // Compute fingerprint
        String fp = ReflectionTestUtils.invokeMethod(service, "computeFingerprint",
                10L, 20L, 300L, slotStart, slotEnd, "Checkup");

        Appointment existing = new Appointment(
                "APP000001", patient, doctor, schedule, patientUser, "req-idem", fp,
                slotStart, slotEnd, AppointmentStatus.PENDING, "Checkup"
        );
        ReflectionTestUtils.setField(existing, "id", 888L);

        when(appointmentRepository.findByCreatedByIdAndRequestKey(1L, "req-idem")).thenReturn(Optional.of(existing));

        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-idem", "Checkup", null);

        AppointmentBookingResult result = service.bookAppointment(patientAuth, request);

        assertThat(result.replayed()).isTrue();
        assertThat(result.appointment().id()).isEqualTo("888");
        verify(appointmentRepository, never()).saveAndFlush(any());
    }

    @Test
    void bookAppointmentIdempotencyConflictSameKeyDifferentPayload() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));

        Instant slotStart = futureTime(2, 8, 30);
        Instant slotEnd = slotStart.plus(Duration.ofMinutes(30));

        Appointment existing = new Appointment(
                "APP000001", patient, doctor, schedule, patientUser, "req-idem", "different_hash",
                slotStart, slotEnd, AppointmentStatus.PENDING, "Checkup"
        );
        when(appointmentRepository.findByCreatedByIdAndRequestKey(1L, "req-idem")).thenReturn(Optional.of(existing));

        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "req-idem", "Other Reason", null);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.bookAppointment(patientAuth, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("IDEMPOTENCY_CONFLICT");
    }

    @Test
    void getAppointmentCrossDoctorOrCrossPatientReturns404() {
        Instant slotStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP1", patient, doctor, schedule, patientUser, "k1", "fp",
                slotStart, slotStart.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Reason");
        ReflectionTestUtils.setField(app, "id", 123L);

        when(appointmentRepository.findById(123L)).thenReturn(Optional.of(app));

        // Other patient (userId = 99L)
        AuthenticatedUser otherPatient = new AuthenticatedUser(99L, "other@p.test", "Other", Role.PATIENT, UserStatus.ACTIVE);
        ManagementException exP = assertThrows(ManagementException.class, () -> service.getAppointment(otherPatient, 123L));
        assertThat(exP.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);

        // Other doctor (userId = 88L)
        AuthenticatedUser otherDoctor = new AuthenticatedUser(88L, "other@d.test", "Other Doc", Role.DOCTOR, UserStatus.ACTIVE);
        ManagementException exD = assertThrows(ManagementException.class, () -> service.getAppointment(otherDoctor, 123L));
        assertThat(exD.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void bookAppointmentSuccessWhenSlotCancelledAndRebooked() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));
        // Slot check returns false because existing appointment has status CANCELLED
        when(appointmentRepository.existsByDoctorIdAndStartAtAndStatusNot(eq(20L), any(), eq(AppointmentStatus.CANCELLED))).thenReturn(false);
        when(appointmentRepository.saveAndFlush(any(Appointment.class))).thenAnswer(inv -> {
            Appointment toSave = inv.getArgument(0);
            ReflectionTestUtils.setField(toSave, "id", 999L);
            return toSave;
        });

        Instant slotStart = futureTime(2, 8, 30);
        AppointmentBookRequest request = new AppointmentBookRequest("300", slotStart, "rebook-after-cancel", "Rebook slot", null);

        AppointmentBookingResult result = service.bookAppointment(patientAuth, request);

        assertThat(result.replayed()).isFalse();
        assertThat(result.appointment().id()).isEqualTo("999");
        assertThat(result.appointment().status()).isEqualTo("PENDING");
    }

    // --- D08 Reschedule & Cancellation Unit Tests ---

    @Test
    void rescheduleAppointmentSuccessForPatient() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));

        Instant oldStart = futureTime(2, 8, 30);
        Instant oldEnd = oldStart.plus(Duration.ofMinutes(30));
        Appointment app = new Appointment("APP100", patient, doctor, schedule, patientUser, "req-k1", "fp1",
                oldStart, oldEnd, AppointmentStatus.CONFIRMED, "Initial checkup");
        ReflectionTestUtils.setField(app, "id", 600L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(600L)).thenReturn(Optional.of(app));
        when(appointmentRepository.existsByDoctorIdAndStartAtAndStatusNotAndIdNot(eq(20L), any(), any(), eq(600L))).thenReturn(false);
        when(appointmentRepository.saveAndFlush(any())).thenAnswer(inv -> {
            Appointment a = inv.getArgument(0);
            ReflectionTestUtils.setField(a, "version", 1L);
            return a;
        });

        Instant newStart = futureTime(2, 9, 30);
        com.clinicmanagement.dto.AppointmentRescheduleRequest request =
                new com.clinicmanagement.dto.AppointmentRescheduleRequest("300", newStart, 0L);

        AppointmentResponse res = service.rescheduleAppointment(patientAuth, 600L, request);

        assertThat(res.id()).isEqualTo("600");
        assertThat(res.startAt()).isEqualTo(newStart);
        assertThat(res.endAt()).isEqualTo(newStart.plus(Duration.ofMinutes(30)));
        assertThat(res.status()).isEqualTo("PENDING");
        assertThat(res.version()).isEqualTo(1L);
        assertThat(res.reason()).isEqualTo("Initial checkup");
        assertThat(res.rescheduledAt()).isNotNull();
        assertThat(res.rescheduledBy()).isEqualTo("1");
        assertThat(res.previousScheduleId()).isEqualTo("300");
        assertThat(res.previousStartAt()).isEqualTo(oldStart);
    }

    @Test
    void rescheduleAppointmentSuccessForReceptionist() {
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));

        Instant oldStart = futureTime(2, 8, 30);
        Instant oldEnd = oldStart.plus(Duration.ofMinutes(30));
        Appointment app = new Appointment("APP101", patient, doctor, schedule, patientUser, "req-k2", "fp2",
                oldStart, oldEnd, AppointmentStatus.PENDING, "Initial checkup");
        ReflectionTestUtils.setField(app, "id", 601L);
        ReflectionTestUtils.setField(app, "version", 2L);

        when(appointmentRepository.findById(601L)).thenReturn(Optional.of(app));
        when(appointmentRepository.existsByDoctorIdAndStartAtAndStatusNotAndIdNot(eq(20L), any(), any(), eq(601L))).thenReturn(false);
        when(appointmentRepository.saveAndFlush(any())).thenAnswer(inv -> {
            Appointment a = inv.getArgument(0);
            ReflectionTestUtils.setField(a, "version", 3L);
            return a;
        });

        Instant newStart = futureTime(2, 10, 0);
        com.clinicmanagement.dto.AppointmentRescheduleRequest request =
                new com.clinicmanagement.dto.AppointmentRescheduleRequest("300", newStart, 2L);

        AppointmentResponse res = service.rescheduleAppointment(receptionistAuth, 601L, request);

        assertThat(res.id()).isEqualTo("601");
        assertThat(res.startAt()).isEqualTo(newStart);
        assertThat(res.status()).isEqualTo("PENDING");
        assertThat(res.version()).isEqualTo(3L);
        assertThat(res.rescheduledAt()).isNotNull();
        assertThat(res.rescheduledBy()).isEqualTo("3");
        assertThat(res.previousScheduleId()).isEqualTo("300");
        assertThat(res.previousStartAt()).isEqualTo(oldStart);
    }

    @Test
    void rescheduleAppointmentFailsIfPatientDoesNotOwnAppointment() {
        Instant oldStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP102", patient, doctor, schedule, patientUser, "req-k3", "fp3",
                oldStart, oldStart.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Check");
        ReflectionTestUtils.setField(app, "id", 602L);

        when(appointmentRepository.findById(602L)).thenReturn(Optional.of(app));

        AuthenticatedUser otherPatient = new AuthenticatedUser(99L, "other@p.test", "Other", Role.PATIENT, UserStatus.ACTIVE);
        when(patientRepository.findByUserId(99L)).thenReturn(Optional.of(mock(Patient.class)));

        Instant newStart = futureTime(2, 9, 0);
        com.clinicmanagement.dto.AppointmentRescheduleRequest request =
                new com.clinicmanagement.dto.AppointmentRescheduleRequest("300", newStart, 0L);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.rescheduleAppointment(otherPatient, 602L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(ex.getCode()).isEqualTo("RESOURCE_NOT_FOUND");
    }

    @Test
    void rescheduleAppointmentFailsOnVersionConflict() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));

        Instant oldStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP103", patient, doctor, schedule, patientUser, "req-k4", "fp4",
                oldStart, oldStart.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Check");
        ReflectionTestUtils.setField(app, "id", 603L);
        ReflectionTestUtils.setField(app, "version", 3L);

        when(appointmentRepository.findById(603L)).thenReturn(Optional.of(app));

        Instant newStart = futureTime(2, 9, 0);
        com.clinicmanagement.dto.AppointmentRescheduleRequest request =
                new com.clinicmanagement.dto.AppointmentRescheduleRequest("300", newStart, 0L); // Expected 0, current is 3

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.rescheduleAppointment(patientAuth, 603L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("VERSION_CONFLICT");
    }

    @Test
    void rescheduleAppointmentFailsIfStatusNotPendingOrConfirmed() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));

        Instant oldStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP104", patient, doctor, schedule, patientUser, "req-k5", "fp5",
                oldStart, oldStart.plus(Duration.ofMinutes(30)), AppointmentStatus.CANCELLED, "Check");
        ReflectionTestUtils.setField(app, "id", 604L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(604L)).thenReturn(Optional.of(app));

        Instant newStart = futureTime(2, 9, 0);
        com.clinicmanagement.dto.AppointmentRescheduleRequest request =
                new com.clinicmanagement.dto.AppointmentRescheduleRequest("300", newStart, 0L);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.rescheduleAppointment(patientAuth, 604L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    void rescheduleAppointmentFailsIfAppointmentAlreadyStarted() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));

        Instant pastStart = Instant.now().minus(Duration.ofHours(2));
        Appointment app = new Appointment("APP105", patient, doctor, schedule, patientUser, "req-k6", "fp6",
                pastStart, pastStart.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Check");
        ReflectionTestUtils.setField(app, "id", 605L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(605L)).thenReturn(Optional.of(app));

        Instant newStart = futureTime(2, 9, 0);
        com.clinicmanagement.dto.AppointmentRescheduleRequest request =
                new com.clinicmanagement.dto.AppointmentRescheduleRequest("300", newStart, 0L);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.rescheduleAppointment(patientAuth, 605L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
        assertThat(ex.getMessage()).contains("already started or passed");
    }

    @Test
    void rescheduleAppointmentFailsIfNewScheduleDifferentDoctor() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));

        Instant oldStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP106", patient, doctor, schedule, patientUser, "req-k7", "fp7",
                oldStart, oldStart.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Check");
        ReflectionTestUtils.setField(app, "id", 606L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(606L)).thenReturn(Optional.of(app));

        Doctor otherDoctor = mock(Doctor.class);
        when(otherDoctor.getId()).thenReturn(999L);
        DoctorSchedule otherSchedule = mock(DoctorSchedule.class);
        when(otherSchedule.getDoctor()).thenReturn(otherDoctor);
        when(scheduleRepository.findById(400L)).thenReturn(Optional.of(otherSchedule));

        Instant newStart = futureTime(2, 9, 0);
        com.clinicmanagement.dto.AppointmentRescheduleRequest request =
                new com.clinicmanagement.dto.AppointmentRescheduleRequest("400", newStart, 0L);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.rescheduleAppointment(patientAuth, 606L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
        assertThat(ex.getMessage()).contains("same doctor");
    }

    @Test
    void rescheduleAppointmentFailsIfTargetSlotAlreadyBooked() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));
        when(scheduleRepository.findById(300L)).thenReturn(Optional.of(schedule));

        Instant oldStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP107", patient, doctor, schedule, patientUser, "req-k8", "fp8",
                oldStart, oldStart.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Check");
        ReflectionTestUtils.setField(app, "id", 607L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(607L)).thenReturn(Optional.of(app));
        when(appointmentRepository.existsByDoctorIdAndStartAtAndStatusNotAndIdNot(eq(20L), any(), any(), eq(607L))).thenReturn(true);

        Instant newStart = futureTime(2, 9, 0);
        com.clinicmanagement.dto.AppointmentRescheduleRequest request =
                new com.clinicmanagement.dto.AppointmentRescheduleRequest("300", newStart, 0L);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.rescheduleAppointment(patientAuth, 607L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("SLOT_ALREADY_BOOKED");
    }

    @Test
    void cancelAppointmentSuccessForPatient() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));

        Instant oldStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP200", patient, doctor, schedule, patientUser, "req-c1", "fpc1",
                oldStart, oldStart.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Initial reason");
        ReflectionTestUtils.setField(app, "id", 700L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(700L)).thenReturn(Optional.of(app));
        when(appointmentRepository.saveAndFlush(any())).thenAnswer(inv -> {
            Appointment a = inv.getArgument(0);
            ReflectionTestUtils.setField(a, "version", 1L);
            return a;
        });

        com.clinicmanagement.dto.AppointmentCancelRequest request =
                new com.clinicmanagement.dto.AppointmentCancelRequest("Bận việc đột xuất", 0L);

        AppointmentResponse res = service.cancelAppointment(patientAuth, 700L, request);

        assertThat(res.id()).isEqualTo("700");
        assertThat(res.status()).isEqualTo("CANCELLED");
        assertThat(res.reason()).isEqualTo("Initial reason");
        assertThat(res.cancellationReason()).isEqualTo("Bận việc đột xuất");
        assertThat(res.cancelledAt()).isNotNull();
        assertThat(res.cancelledBy()).isEqualTo("1");
        assertThat(res.version()).isEqualTo(1L);
    }

    @Test
    void cancelAppointmentSuccessForReceptionist() {
        Instant oldStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP201", patient, doctor, schedule, patientUser, "req-c2", "fpc2",
                oldStart, oldStart.plus(Duration.ofMinutes(30)), AppointmentStatus.CONFIRMED, "Initial reason");
        ReflectionTestUtils.setField(app, "id", 701L);
        ReflectionTestUtils.setField(app, "version", 1L);

        when(appointmentRepository.findById(701L)).thenReturn(Optional.of(app));
        when(appointmentRepository.saveAndFlush(any())).thenAnswer(inv -> {
            Appointment a = inv.getArgument(0);
            ReflectionTestUtils.setField(a, "version", 2L);
            return a;
        });

        com.clinicmanagement.dto.AppointmentCancelRequest request =
                new com.clinicmanagement.dto.AppointmentCancelRequest("Khách gọi điện xin hủy", 1L);

        AppointmentResponse res = service.cancelAppointment(receptionistAuth, 701L, request);

        assertThat(res.id()).isEqualTo("701");
        assertThat(res.status()).isEqualTo("CANCELLED");
        assertThat(res.reason()).isEqualTo("Initial reason");
        assertThat(res.cancellationReason()).isEqualTo("Khách gọi điện xin hủy");
        assertThat(res.cancelledAt()).isNotNull();
        assertThat(res.cancelledBy()).isEqualTo("3");
        assertThat(res.version()).isEqualTo(2L);
    }

    @Test
    void cancelAppointmentFailsOnRepeatedCancel() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));

        Instant oldStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP202", patient, doctor, schedule, patientUser, "req-c3", "fpc3",
                oldStart, oldStart.plus(Duration.ofMinutes(30)), AppointmentStatus.CANCELLED, "Đã hủy lần 1");
        ReflectionTestUtils.setField(app, "id", 702L);
        ReflectionTestUtils.setField(app, "version", 1L);

        when(appointmentRepository.findById(702L)).thenReturn(Optional.of(app));

        com.clinicmanagement.dto.AppointmentCancelRequest request =
                new com.clinicmanagement.dto.AppointmentCancelRequest("Hủy lần 2", 1L);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.cancelAppointment(patientAuth, 702L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
        assertThat(ex.getMessage()).contains("already cancelled");
    }

    @Test
    void cancelAppointmentFailsOnVersionMismatch() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));

        Instant oldStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP203", patient, doctor, schedule, patientUser, "req-c4", "fpc4",
                oldStart, oldStart.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Reason");
        ReflectionTestUtils.setField(app, "id", 703L);
        ReflectionTestUtils.setField(app, "version", 2L);

        when(appointmentRepository.findById(703L)).thenReturn(Optional.of(app));

        com.clinicmanagement.dto.AppointmentCancelRequest request =
                new com.clinicmanagement.dto.AppointmentCancelRequest("Lý do", 0L); // Stale version 0

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.cancelAppointment(patientAuth, 703L, request));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("VERSION_CONFLICT");
    }

    @Test
    void cancelAppointmentFailsIfReasonEmptyOrBlank() {
        com.clinicmanagement.dto.AppointmentCancelRequest requestEmpty =
                new com.clinicmanagement.dto.AppointmentCancelRequest("", 0L);

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.cancelAppointment(patientAuth, 704L, requestEmpty));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void cancelAppointmentReasonLength255SuccessAnd256Fails() {
        when(patientRepository.findByUserId(1L)).thenReturn(Optional.of(patient));

        Instant oldStart = futureTime(2, 8, 30);
        Appointment app = new Appointment("APP204", patient, doctor, schedule, patientUser, "req-c5", "fpc5",
                oldStart, oldStart.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Initial reason");
        ReflectionTestUtils.setField(app, "id", 705L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(705L)).thenReturn(Optional.of(app));
        when(appointmentRepository.saveAndFlush(any())).thenAnswer(inv -> {
            Appointment a = inv.getArgument(0);
            ReflectionTestUtils.setField(a, "version", 1L);
            return a;
        });

        // 255 chars -> valid
        String reason255 = "A".repeat(255);
        com.clinicmanagement.dto.AppointmentCancelRequest req255 =
                new com.clinicmanagement.dto.AppointmentCancelRequest(reason255, 0L);
        AppointmentResponse res255 = service.cancelAppointment(patientAuth, 705L, req255);
        assertThat(res255.cancellationReason()).isEqualTo(reason255);

        // 256 chars -> invalid 400
        String reason256 = "A".repeat(256);
        com.clinicmanagement.dto.AppointmentCancelRequest req256 =
                new com.clinicmanagement.dto.AppointmentCancelRequest(reason256, 0L);
        ManagementException ex256 = assertThrows(ManagementException.class,
                () -> service.cancelAppointment(patientAuth, 705L, req256));
        assertThat(ex256.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex256.getCode()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void confirmAppointmentSuccess() {
        Instant start = futureTime(2, 9, 0);
        Appointment app = new Appointment("APP301", patient, doctor, schedule, patientUser, "req-cf1", "fpcf1",
                start, start.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Checkup");
        ReflectionTestUtils.setField(app, "id", 801L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(801L)).thenReturn(Optional.of(app));
        when(appointmentRepository.saveAndFlush(any())).thenAnswer(inv -> {
            Appointment a = inv.getArgument(0);
            ReflectionTestUtils.setField(a, "version", 1L);
            return a;
        });

        AppointmentResponse res = service.confirmAppointment(receptionistAuth, 801L,
                new com.clinicmanagement.dto.AppointmentTransitionRequest(0L));

        assertThat(res.status()).isEqualTo("CONFIRMED");
        assertThat(res.confirmedAt()).isNotNull();
        assertThat(res.confirmedBy()).isEqualTo("3");
        assertThat(res.version()).isEqualTo(1L);
    }

    @Test
    void confirmAppointmentFailsIfNotPending() {
        Instant start = futureTime(2, 9, 0);
        Appointment app = new Appointment("APP302", patient, doctor, schedule, patientUser, "req-cf2", "fpcf2",
                start, start.plus(Duration.ofMinutes(30)), AppointmentStatus.CANCELLED, "Checkup");
        ReflectionTestUtils.setField(app, "id", 802L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(802L)).thenReturn(Optional.of(app));

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.confirmAppointment(receptionistAuth, 802L,
                        new com.clinicmanagement.dto.AppointmentTransitionRequest(0L)));

        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    void confirmAppointmentFailsIfPastStartAt() {
        Instant pastStart = Instant.now().minus(Duration.ofHours(1));
        Appointment app = new Appointment("APP303", patient, doctor, schedule, patientUser, "req-cf3", "fpcf3",
                pastStart, pastStart.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Checkup");
        ReflectionTestUtils.setField(app, "id", 803L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(803L)).thenReturn(Optional.of(app));

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.confirmAppointment(receptionistAuth, 803L,
                        new com.clinicmanagement.dto.AppointmentTransitionRequest(0L)));

        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    void confirmAppointmentFailsOnVersionConflict() {
        Instant start = futureTime(2, 9, 0);
        Appointment app = new Appointment("APP304", patient, doctor, schedule, patientUser, "req-cf4", "fpcf4",
                start, start.plus(Duration.ofMinutes(30)), AppointmentStatus.PENDING, "Checkup");
        ReflectionTestUtils.setField(app, "id", 804L);
        ReflectionTestUtils.setField(app, "version", 1L);

        when(appointmentRepository.findById(804L)).thenReturn(Optional.of(app));

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.confirmAppointment(receptionistAuth, 804L,
                        new com.clinicmanagement.dto.AppointmentTransitionRequest(0L))); // Expected 0, actual 1

        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("VERSION_CONFLICT");
    }

    @Test
    void checkInAppointmentSuccess() {
        Instant now = Instant.now();
        Instant start = now.minus(Duration.ofMinutes(10));
        Instant end = now.plus(Duration.ofMinutes(20));

        Appointment app = new Appointment("APP305", patient, doctor, schedule, patientUser, "req-ci1", "fpci1",
                start, end, AppointmentStatus.CONFIRMED, "Checkup");
        ReflectionTestUtils.setField(app, "id", 805L);
        ReflectionTestUtils.setField(app, "version", 1L);

        when(appointmentRepository.findById(805L)).thenReturn(Optional.of(app));
        when(appointmentRepository.saveAndFlush(any())).thenAnswer(inv -> {
            Appointment a = inv.getArgument(0);
            ReflectionTestUtils.setField(a, "version", 2L);
            return a;
        });

        AppointmentResponse res = service.checkInAppointment(receptionistAuth, 805L,
                new com.clinicmanagement.dto.AppointmentTransitionRequest(1L));

        assertThat(res.status()).isEqualTo("CHECKED_IN");
        assertThat(res.checkedInAt()).isNotNull();
        assertThat(res.checkedInBy()).isEqualTo("3");
        assertThat(res.version()).isEqualTo(2L);
    }

    @Test
    void checkInAppointmentRepeatedReturnsCurrentWithoutBumpingVersion() {
        Instant now = Instant.now();
        Instant start = now.minus(Duration.ofMinutes(10));
        Instant end = now.plus(Duration.ofMinutes(20));

        Appointment app = new Appointment("APP306", patient, doctor, schedule, patientUser, "req-ci2", "fpci2",
                start, end, AppointmentStatus.CHECKED_IN, "Checkup");
        ReflectionTestUtils.setField(app, "id", 806L);
        ReflectionTestUtils.setField(app, "version", 2L);
        ReflectionTestUtils.setField(app, "checkedInAt", now.minus(Duration.ofMinutes(5)));
        ReflectionTestUtils.setField(app, "checkedInBy", patientUser);

        when(appointmentRepository.findById(806L)).thenReturn(Optional.of(app));

        // Replay with version before check-in (1)
        AppointmentResponse res1 = service.checkInAppointment(receptionistAuth, 806L,
                new com.clinicmanagement.dto.AppointmentTransitionRequest(1L));
        assertThat(res1.status()).isEqualTo("CHECKED_IN");
        assertThat(res1.version()).isEqualTo(2L);

        // Replay with current version (2)
        AppointmentResponse res2 = service.checkInAppointment(receptionistAuth, 806L,
                new com.clinicmanagement.dto.AppointmentTransitionRequest(2L));
        assertThat(res2.status()).isEqualTo("CHECKED_IN");
        assertThat(res2.version()).isEqualTo(2L);

        verify(appointmentRepository, never()).saveAndFlush(any());
    }

    @Test
    void checkInAppointmentFailsIfPending() {
        Instant now = Instant.now();
        Instant start = now.minus(Duration.ofMinutes(10));
        Instant end = now.plus(Duration.ofMinutes(20));

        Appointment app = new Appointment("APP307", patient, doctor, schedule, patientUser, "req-ci3", "fpci3",
                start, end, AppointmentStatus.PENDING, "Checkup");
        ReflectionTestUtils.setField(app, "id", 807L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(807L)).thenReturn(Optional.of(app));

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.checkInAppointment(receptionistAuth, 807L,
                        new com.clinicmanagement.dto.AppointmentTransitionRequest(0L)));

        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    void checkInAppointmentFailsIfNotToday() {
        Instant start = futureTime(2, 9, 0); // 2 days in future
        Instant end = start.plus(Duration.ofMinutes(30));

        Appointment app = new Appointment("APP308", patient, doctor, schedule, patientUser, "req-ci4", "fpci4",
                start, end, AppointmentStatus.CONFIRMED, "Checkup");
        ReflectionTestUtils.setField(app, "id", 808L);
        ReflectionTestUtils.setField(app, "version", 1L);

        when(appointmentRepository.findById(808L)).thenReturn(Optional.of(app));

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.checkInAppointment(receptionistAuth, 808L,
                        new com.clinicmanagement.dto.AppointmentTransitionRequest(1L)));

        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    void checkInAppointmentFailsIfAfterEndAt() {
        Instant now = Instant.now();
        Instant start = now.minus(Duration.ofMinutes(40));
        Instant end = now.minus(Duration.ofMinutes(10)); // slot already ended

        Appointment app = new Appointment("APP309", patient, doctor, schedule, patientUser, "req-ci5", "fpci5",
                start, end, AppointmentStatus.CONFIRMED, "Checkup");
        ReflectionTestUtils.setField(app, "id", 809L);
        ReflectionTestUtils.setField(app, "version", 1L);

        when(appointmentRepository.findById(809L)).thenReturn(Optional.of(app));

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.checkInAppointment(receptionistAuth, 809L,
                        new com.clinicmanagement.dto.AppointmentTransitionRequest(1L)));

        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    void checkInAppointmentFailsOnVersionConflict() {
        Instant now = Instant.now();
        Instant start = now.minus(Duration.ofMinutes(10));
        Instant end = now.plus(Duration.ofMinutes(20));

        Appointment app = new Appointment("APP310", patient, doctor, schedule, patientUser, "req-ci6", "fpci6",
                start, end, AppointmentStatus.CONFIRMED, "Checkup");
        ReflectionTestUtils.setField(app, "id", 810L);
        ReflectionTestUtils.setField(app, "version", 2L);

        when(appointmentRepository.findById(810L)).thenReturn(Optional.of(app));

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.checkInAppointment(receptionistAuth, 810L,
                        new com.clinicmanagement.dto.AppointmentTransitionRequest(0L)));

        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("VERSION_CONFLICT");
    }

    @Test
    void markNoShowSuccess() {
        Instant pastStart = Instant.now().minus(Duration.ofMinutes(40));
        Instant pastEnd = Instant.now().minus(Duration.ofMinutes(10));

        Appointment app = new Appointment("APP311", patient, doctor, schedule, patientUser, "req-ns1", "fpns1",
                pastStart, pastEnd, AppointmentStatus.CONFIRMED, "Checkup");
        ReflectionTestUtils.setField(app, "id", 811L);
        ReflectionTestUtils.setField(app, "version", 1L);

        when(appointmentRepository.findById(811L)).thenReturn(Optional.of(app));
        when(appointmentRepository.saveAndFlush(any())).thenAnswer(inv -> {
            Appointment a = inv.getArgument(0);
            ReflectionTestUtils.setField(a, "version", 2L);
            return a;
        });

        AppointmentResponse res = service.markNoShow(receptionistAuth, 811L,
                new com.clinicmanagement.dto.AppointmentTransitionRequest(1L));

        assertThat(res.status()).isEqualTo("NO_SHOW");
        assertThat(res.noShowAt()).isNotNull();
        assertThat(res.noShowBy()).isEqualTo("3");
        assertThat(res.version()).isEqualTo(2L);
    }

    @Test
    void markNoShowFailsIfBeforeEndAt() {
        Instant start = futureTime(1, 9, 0);
        Instant end = start.plus(Duration.ofMinutes(30));

        Appointment app = new Appointment("APP312", patient, doctor, schedule, patientUser, "req-ns2", "fpns2",
                start, end, AppointmentStatus.CONFIRMED, "Checkup");
        ReflectionTestUtils.setField(app, "id", 812L);
        ReflectionTestUtils.setField(app, "version", 1L);

        when(appointmentRepository.findById(812L)).thenReturn(Optional.of(app));

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.markNoShow(receptionistAuth, 812L,
                        new com.clinicmanagement.dto.AppointmentTransitionRequest(1L)));

        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    void markNoShowFailsIfNotConfirmed() {
        Instant pastStart = Instant.now().minus(Duration.ofMinutes(40));
        Instant pastEnd = Instant.now().minus(Duration.ofMinutes(10));

        Appointment app = new Appointment("APP313", patient, doctor, schedule, patientUser, "req-ns3", "fpns3",
                pastStart, pastEnd, AppointmentStatus.PENDING, "Checkup");
        ReflectionTestUtils.setField(app, "id", 813L);
        ReflectionTestUtils.setField(app, "version", 0L);

        when(appointmentRepository.findById(813L)).thenReturn(Optional.of(app));

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.markNoShow(receptionistAuth, 813L,
                        new com.clinicmanagement.dto.AppointmentTransitionRequest(0L)));

        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    void markNoShowFailsOnVersionConflict() {
        Instant pastStart = Instant.now().minus(Duration.ofMinutes(40));
        Instant pastEnd = Instant.now().minus(Duration.ofMinutes(10));

        Appointment app = new Appointment("APP314", patient, doctor, schedule, patientUser, "req-ns4", "fpns4",
                pastStart, pastEnd, AppointmentStatus.CONFIRMED, "Checkup");
        ReflectionTestUtils.setField(app, "id", 814L);
        ReflectionTestUtils.setField(app, "version", 2L);

        when(appointmentRepository.findById(814L)).thenReturn(Optional.of(app));

        ManagementException ex = assertThrows(ManagementException.class,
                () -> service.markNoShow(receptionistAuth, 814L,
                        new com.clinicmanagement.dto.AppointmentTransitionRequest(0L)));

        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("VERSION_CONFLICT");
    }
}

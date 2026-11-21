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

    private final AppointmentService service = new AppointmentService(
            appointmentRepository, scheduleRepository, doctorRepository, patientRepository, userRepository);

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
}

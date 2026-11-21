package com.clinicmanagement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.clinicmanagement.dto.DoctorScheduleCreateRequest;
import com.clinicmanagement.dto.DoctorSchedulePatchRequest;
import com.clinicmanagement.dto.DoctorScheduleResponse;
import com.clinicmanagement.dto.ScheduleSlotResponse;
import com.clinicmanagement.entity.*;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.DoctorRepository;
import com.clinicmanagement.repository.DoctorScheduleRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class DoctorScheduleServiceTest {
    private final DoctorScheduleRepository scheduleRepository = mock(DoctorScheduleRepository.class);
    private final DoctorRepository doctorRepository = mock(DoctorRepository.class);
    private final DoctorScheduleService service = new DoctorScheduleService(scheduleRepository, doctorRepository);

    private Doctor doctor;
    private User doctorUser;
    private Specialty specialty;

    @BeforeEach
    void setUp() {
        doctorUser = User.registerPatient("doctor@clinic.test", "hash", "Dr. Nguyen");
        // set role to DOCTOR
        org.springframework.test.util.ReflectionTestUtils.setField(doctorUser, "id", 10L);
        org.springframework.test.util.ReflectionTestUtils.setField(doctorUser, "role", Role.DOCTOR);
        org.springframework.test.util.ReflectionTestUtils.setField(doctorUser, "status", UserStatus.ACTIVE);

        specialty = new Specialty("GEN", "General", "Desc", true);
        org.springframework.test.util.ReflectionTestUtils.setField(specialty, "id", 1L);

        doctor = new Doctor(doctorUser, specialty, "DOC001", "LIC001", "Bio", true);
        org.springframework.test.util.ReflectionTestUtils.setField(doctor, "id", 100L);
    }

    private Instant futureTime(int plusDays, int hour, int minute) {
        LocalDate targetDate = LocalDate.now(DoctorScheduleService.ZONE_VN).plusDays(plusDays);
        ZonedDateTime vnTime = targetDate.atTime(hour, minute).atZone(DoctorScheduleService.ZONE_VN);
        return vnTime.toInstant();
    }

    @Test
    void createScheduleSuccess() {
        Instant start = futureTime(2, 8, 0);
        Instant end = futureTime(2, 12, 0);

        when(doctorRepository.findLocked(100L)).thenReturn(Optional.of(doctor));
        when(scheduleRepository.existsOverlapping(eq(100L), eq(ScheduleStatus.ACTIVE), eq(start), eq(end), any()))
                .thenReturn(false);

        DoctorSchedule saved = new DoctorSchedule(doctor, start.atZone(DoctorScheduleService.ZONE_VN).toLocalDate(),
                start, end, 30, ScheduleStatus.ACTIVE);
        org.springframework.test.util.ReflectionTestUtils.setField(saved, "id", 1L);
        when(scheduleRepository.saveAndFlush(any(DoctorSchedule.class))).thenReturn(saved);

        DoctorScheduleResponse res = service.create(new DoctorScheduleCreateRequest(100L, start, end, 30, ScheduleStatus.ACTIVE));
        assertThat(res.id()).isEqualTo("1");
        assertThat(res.doctorId()).isEqualTo("100");
        assertThat(res.slotMinutes()).isEqualTo(30);
        assertThat(res.status()).isEqualTo(ScheduleStatus.ACTIVE);
    }

    @Test
    void createScheduleFailsIfDoctorNotFound() {
        Instant start = futureTime(2, 8, 0);
        Instant end = futureTime(2, 12, 0);
        when(doctorRepository.findLocked(999L)).thenReturn(Optional.empty());

        ManagementException ex = assertThrows(ManagementException.class, () ->
                service.create(new DoctorScheduleCreateRequest(999L, start, end, 30, ScheduleStatus.ACTIVE)));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(ex.getCode()).isEqualTo("RESOURCE_NOT_FOUND");
    }

    @Test
    void createScheduleFailsIfDoctorInactive() {
        org.springframework.test.util.ReflectionTestUtils.setField(doctor, "active", false);
        Instant start = futureTime(2, 8, 0);
        Instant end = futureTime(2, 12, 0);
        when(doctorRepository.findLocked(100L)).thenReturn(Optional.of(doctor));

        ManagementException ex = assertThrows(ManagementException.class, () ->
                service.create(new DoctorScheduleCreateRequest(100L, start, end, 30, ScheduleStatus.ACTIVE)));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("DOCTOR_INACTIVE");
    }

    @Test
    void createScheduleFailsIfStartInPast() {
        Instant pastStart = Instant.now().minus(Duration.ofHours(2));
        Instant futureEnd = Instant.now().plus(Duration.ofHours(2));

        ManagementException ex = assertThrows(ManagementException.class, () ->
                service.create(new DoctorScheduleCreateRequest(100L, pastStart, futureEnd, 30, ScheduleStatus.ACTIVE)));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void createScheduleFailsIfEndBeforeStart() {
        Instant start = futureTime(2, 12, 0);
        Instant end = futureTime(2, 8, 0);

        ManagementException ex = assertThrows(ManagementException.class, () ->
                service.create(new DoctorScheduleCreateRequest(100L, start, end, 30, ScheduleStatus.ACTIVE)));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void createScheduleFailsIfCrossesMidnight() {
        // Starts on day 2 at 22:00, ends on day 3 at 02:00
        Instant start = futureTime(2, 22, 0);
        Instant end = futureTime(3, 2, 0);

        ManagementException ex = assertThrows(ManagementException.class, () ->
                service.create(new DoctorScheduleCreateRequest(100L, start, end, 30, ScheduleStatus.ACTIVE)));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void createScheduleFailsIfInvalidSlotMinutes() {
        Instant start = futureTime(2, 8, 0);
        Instant end = futureTime(2, 12, 0);

        ManagementException ex = assertThrows(ManagementException.class, () ->
                service.create(new DoctorScheduleCreateRequest(100L, start, end, 45, ScheduleStatus.ACTIVE)));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getCode()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void createScheduleFailsOnOverlap() {
        Instant start = futureTime(2, 8, 0);
        Instant end = futureTime(2, 12, 0);

        when(doctorRepository.findLocked(100L)).thenReturn(Optional.of(doctor));
        when(scheduleRepository.existsOverlapping(eq(100L), eq(ScheduleStatus.ACTIVE), eq(start), eq(end), any()))
                .thenReturn(true);

        ManagementException ex = assertThrows(ManagementException.class, () ->
                service.create(new DoctorScheduleCreateRequest(100L, start, end, 30, ScheduleStatus.ACTIVE)));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("SCHEDULE_OVERLAP");
    }

    @Test
    void getScheduleDoctorScopeIsolation() {
        Instant start = futureTime(2, 8, 0);
        Instant end = futureTime(2, 12, 0);
        DoctorSchedule schedule = new DoctorSchedule(doctor, start.atZone(DoctorScheduleService.ZONE_VN).toLocalDate(),
                start, end, 30, ScheduleStatus.ACTIVE);
        org.springframework.test.util.ReflectionTestUtils.setField(schedule, "id", 1L);

        when(scheduleRepository.findById(1L)).thenReturn(Optional.of(schedule));

        // DOCTOR viewing own schedule
        AuthenticatedUser ownDoctorUser = new AuthenticatedUser(10L, "doc@test.com", "Dr. Nguyen", Role.DOCTOR, UserStatus.ACTIVE);
        when(doctorRepository.findByUserId(10L)).thenReturn(Optional.of(doctor));
        DoctorScheduleResponse res = service.get(ownDoctorUser, 1L);
        assertThat(res.id()).isEqualTo("1");

        // DOCTOR viewing another doctor's schedule -> 404
        AuthenticatedUser otherDoctorUser = new AuthenticatedUser(20L, "other@test.com", "Dr. Other", Role.DOCTOR, UserStatus.ACTIVE);
        Doctor otherDoctor = new Doctor(doctorUser, specialty, "DOC002", "LIC002", "Bio", true);
        org.springframework.test.util.ReflectionTestUtils.setField(otherDoctor, "id", 200L);
        when(doctorRepository.findByUserId(20L)).thenReturn(Optional.of(otherDoctor));

        ManagementException ex = assertThrows(ManagementException.class, () -> service.get(otherDoctorUser, 1L));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);

        // PATIENT viewing schedule management -> 403
        AuthenticatedUser patientUser = new AuthenticatedUser(30L, "pat@test.com", "Patient", Role.PATIENT, UserStatus.ACTIVE);
        ManagementException patEx = assertThrows(ManagementException.class, () -> service.get(patientUser, 1L));
        assertThat(patEx.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void patchScheduleReactivationChecksOverlap() {
        Instant start = futureTime(2, 8, 0);
        Instant end = futureTime(2, 12, 0);
        DoctorSchedule schedule = new DoctorSchedule(doctor, start.atZone(DoctorScheduleService.ZONE_VN).toLocalDate(),
                start, end, 30, ScheduleStatus.BLOCKED);
        org.springframework.test.util.ReflectionTestUtils.setField(schedule, "id", 1L);

        when(scheduleRepository.findById(1L)).thenReturn(Optional.of(schedule));
        when(doctorRepository.findLocked(100L)).thenReturn(Optional.of(doctor));
        when(scheduleRepository.existsOverlapping(eq(100L), eq(ScheduleStatus.ACTIVE), eq(start), eq(end), eq(1L)))
                .thenReturn(true);

        ManagementException ex = assertThrows(ManagementException.class, () ->
                service.patch(1L, new DoctorSchedulePatchRequest(null, null, null, ScheduleStatus.ACTIVE)));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("SCHEDULE_OVERLAP");
    }

    @Test
    void getSlotsGeneratesCorrectIntervals() {
        Instant start = futureTime(2, 8, 0);
        Instant end = futureTime(2, 10, 0); // 2 hours = 4 slots of 30 mins
        DoctorSchedule schedule = new DoctorSchedule(doctor, start.atZone(DoctorScheduleService.ZONE_VN).toLocalDate(),
                start, end, 30, ScheduleStatus.ACTIVE);
        org.springframework.test.util.ReflectionTestUtils.setField(schedule, "id", 1L);

        when(doctorRepository.findById(100L)).thenReturn(Optional.of(doctor));
        LocalDate queryDate = start.atZone(DoctorScheduleService.ZONE_VN).toLocalDate();
        when(scheduleRepository.findByDoctorIdAndStatusAndWorkDateBetweenOrderByStartAtAsc(
                eq(100L), eq(ScheduleStatus.ACTIVE), eq(queryDate), eq(queryDate)))
                .thenReturn(List.of(schedule));

        List<ScheduleSlotResponse> slots = service.getSlots(100L, queryDate, null, null);
        assertThat(slots).hasSize(4);
        assertThat(slots.get(0).startAt()).isEqualTo(start);
        assertThat(slots.get(0).endAt()).isEqualTo(start.plus(Duration.ofMinutes(30)));
        assertThat(slots.get(3).endAt()).isEqualTo(end);
        assertThat(slots.get(0).isAvailable()).isTrue();
    }
}

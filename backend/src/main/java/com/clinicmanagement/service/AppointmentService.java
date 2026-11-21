package com.clinicmanagement.service;

import com.clinicmanagement.dto.*;
import com.clinicmanagement.entity.*;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.*;
import com.clinicmanagement.security.AuthenticatedUser;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;

@Service
@Transactional(readOnly = true)
public class AppointmentService {
    private final AppointmentRepository appointmentRepository;
    private final DoctorScheduleRepository scheduleRepository;
    private final DoctorRepository doctorRepository;
    private final PatientRepository patientRepository;
    private final UserRepository userRepository;
    private final SecureRandom random = new SecureRandom();

    public AppointmentService(AppointmentRepository appointmentRepository,
                              DoctorScheduleRepository scheduleRepository,
                              DoctorRepository doctorRepository,
                              PatientRepository patientRepository,
                              UserRepository userRepository) {
        this.appointmentRepository = appointmentRepository;
        this.scheduleRepository = scheduleRepository;
        this.doctorRepository = doctorRepository;
        this.patientRepository = patientRepository;
        this.userRepository = userRepository;
    }

    @Transactional
    @PreAuthorize("hasAnyRole('RECEPTIONIST', 'PATIENT')")
    public AppointmentBookingResult bookAppointment(AuthenticatedUser actor, AppointmentBookRequest request) {
        if (request == null) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Request body is required.");
        }

        Long scheduleId = parsePositiveLong(request.scheduleId(), "Schedule ID must be a positive integer.");
        Instant startAt = request.startAt();
        if (startAt == null) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Start time is required.");
        }
        if (!startAt.isAfter(Instant.now())) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Appointment start time must be in the future.");
        }

        String requestKey = request.requestKey() != null ? request.requestKey().trim() : "";
        if (requestKey.isEmpty() || requestKey.length() > 64) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Request key must be between 1 and 64 characters.");
        }

        String reason = request.reason() != null ? request.reason().trim() : null;
        if (reason != null && reason.length() > 500) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Reason cannot exceed 500 characters.");
        }

        // Determine target patient based on actor role
        Patient targetPatient;
        if (actor.role() == Role.PATIENT) {
            if (request.hasPatientId()) {
                throw new ManagementException(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Patients cannot specify patientId. Booking is restricted to linked patient profile.");
            }
            targetPatient = patientRepository.findByUserId(actor.id())
                    .orElseThrow(() -> new ManagementException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "No linked patient profile found for patient user."));
        } else if (actor.role() == Role.RECEPTIONIST) {
            if (!request.hasPatientId()) {
                throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "patientId is required for receptionist booking.");
            }
            Long patientId = parsePositiveLong(request.patientId(), "Patient ID must be a positive integer.");
            targetPatient = patientRepository.findById(patientId)
                    .orElseThrow(() -> new ManagementException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Patient not found."));
        } else {
            throw new ManagementException(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Only patients and receptionists can book appointments.");
        }

        if (!targetPatient.isActive()) {
            throw new ManagementException(HttpStatus.CONFLICT, "PATIENT_INACTIVE", "Patient profile is inactive.");
        }

        DoctorSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(ManagementException::missing);

        if (schedule.getStatus() != ScheduleStatus.ACTIVE) {
            throw new ManagementException(HttpStatus.CONFLICT, "SCHEDULE_BLOCKED", "Doctor schedule is blocked and cannot accept appointments.");
        }

        Doctor doctor = schedule.getDoctor();
        if (!doctor.isActive()) {
            throw new ManagementException(HttpStatus.CONFLICT, "DOCTOR_INACTIVE", "Doctor is inactive.");
        }
        if (doctor.getUser().getStatus() != UserStatus.ACTIVE) {
            throw new ManagementException(HttpStatus.CONFLICT, "USER_NOT_ACTIVE", "Doctor account is not active.");
        }

        // Slot grid and time range validation
        int slotMinutes = schedule.getSlotMinutes();
        Duration slotDuration = Duration.ofMinutes(slotMinutes);
        Instant calculatedEndAt = startAt.plus(slotDuration);

        if (startAt.isBefore(schedule.getStartAt()) || calculatedEndAt.isAfter(schedule.getEndAt())) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Appointment time must be within doctor schedule hours.");
        }

        long minutesFromStart = Duration.between(schedule.getStartAt(), startAt).toMinutes();
        if (minutesFromStart % slotMinutes != 0) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Appointment start time must align with the schedule slot grid.");
        }

        String computedFingerprint = computeFingerprint(targetPatient.getId(), doctor.getId(), schedule.getId(), startAt, calculatedEndAt, reason);

        // Check idempotency before acquiring lock
        Optional<Appointment> existingOpt = appointmentRepository.findByCreatedByIdAndRequestKey(actor.id(), requestKey);
        if (existingOpt.isPresent()) {
            Appointment existing = existingOpt.get();
            if (existing.getRequestFingerprint().equals(computedFingerprint)) {
                return new AppointmentBookingResult(AppointmentResponse.from(existing), true);
            } else {
                throw new ManagementException(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", "Request key has already been used with a different booking request.");
            }
        }

        // Lock parent doctor to serialize bookings and schedule patches
        doctorRepository.findLocked(doctor.getId()).orElseThrow(ManagementException::missing);

        // Re-check idempotency under lock
        existingOpt = appointmentRepository.findByCreatedByIdAndRequestKey(actor.id(), requestKey);
        if (existingOpt.isPresent()) {
            Appointment existing = existingOpt.get();
            if (existing.getRequestFingerprint().equals(computedFingerprint)) {
                return new AppointmentBookingResult(AppointmentResponse.from(existing), true);
            } else {
                throw new ManagementException(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", "Request key has already been used with a different booking request.");
            }
        }

        // Re-verify schedule is still active under lock
        DoctorSchedule freshSchedule = scheduleRepository.findById(schedule.getId()).orElseThrow(ManagementException::missing);
        if (freshSchedule.getStatus() != ScheduleStatus.ACTIVE) {
            throw new ManagementException(HttpStatus.CONFLICT, "SCHEDULE_BLOCKED", "Doctor schedule is blocked and cannot accept appointments.");
        }

        // Check if slot is already occupied
        boolean slotTaken = appointmentRepository.existsByDoctorIdAndStartAtAndStatusNot(
                doctor.getId(), startAt, AppointmentStatus.CANCELLED);
        if (slotTaken) {
            throw new ManagementException(HttpStatus.CONFLICT, "SLOT_ALREADY_BOOKED", "Selected appointment slot is already booked.");
        }

        User creator = userRepository.findById(actor.id())
                .orElseThrow(() -> new ManagementException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "User not found."));

        String appointmentCode = generateAppointmentCode();

        Appointment appointment = new Appointment(
                appointmentCode,
                targetPatient,
                doctor,
                freshSchedule,
                creator,
                requestKey,
                computedFingerprint,
                startAt,
                calculatedEndAt,
                AppointmentStatus.PENDING,
                reason
        );

        try {
            Appointment saved = appointmentRepository.saveAndFlush(appointment);
            return new AppointmentBookingResult(AppointmentResponse.from(saved), false);
        } catch (DataIntegrityViolationException ex) {
            String msg = ex.getMessage() != null ? ex.getMessage() : "";
            if (msg.contains("uk_appointments_doctor_active_slot") || msg.contains("uk_appointments_doctor_start")) {
                throw new ManagementException(HttpStatus.CONFLICT, "SLOT_ALREADY_BOOKED", "Selected appointment slot is already booked.");
            }
            if (msg.contains("uk_appointments_created_by_request_key")) {
                Optional<Appointment> concurrent = appointmentRepository.findByCreatedByIdAndRequestKey(actor.id(), requestKey);
                if (concurrent.isPresent() && concurrent.get().getRequestFingerprint().equals(computedFingerprint)) {
                    return new AppointmentBookingResult(AppointmentResponse.from(concurrent.get()), true);
                }
                throw new ManagementException(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", "Request key has already been used with a different booking request.");
            }
            throw new ManagementException(HttpStatus.CONFLICT, "APPOINTMENT_CONFLICT", "Data conflict while creating appointment.");
        }
    }

    @PreAuthorize("hasAnyRole('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PATIENT')")
    public PageResponse<AppointmentResponse> listAppointments(
            AuthenticatedUser viewer,
            Long doctorId,
            Long patientId,
            LocalDate date,
            AppointmentStatus status,
            Pageable pageable) {

        Specification<Appointment> spec = (root, query, cb) -> cb.conjunction();

        if (viewer.role() == Role.DOCTOR) {
            Doctor myDoctor = doctorRepository.findByUserId(viewer.id())
                    .orElseThrow(() -> new ManagementException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Doctor profile not found for user."));
            spec = spec.and((root, query, cb) -> cb.equal(root.get("doctor").get("id"), myDoctor.getId()));
        } else if (viewer.role() == Role.PATIENT) {
            Patient myPatient = patientRepository.findByUserId(viewer.id())
                    .orElseThrow(() -> new ManagementException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Patient profile not found for user."));
            spec = spec.and((root, query, cb) -> cb.equal(root.get("patient").get("id"), myPatient.getId()));
        } else {
            // ADMIN / RECEPTIONIST can filter freely
            if (doctorId != null) {
                spec = spec.and((root, query, cb) -> cb.equal(root.get("doctor").get("id"), doctorId));
            }
            if (patientId != null) {
                spec = spec.and((root, query, cb) -> cb.equal(root.get("patient").get("id"), patientId));
            }
        }

        if (status != null) {
            spec = spec.and((root, query, cb) -> cb.equal(root.get("status"), status));
        }

        if (date != null) {
            Instant dayStart = date.atStartOfDay(DoctorScheduleService.ZONE_VN).toInstant();
            Instant dayEnd = date.plusDays(1).atStartOfDay(DoctorScheduleService.ZONE_VN).toInstant();
            spec = spec.and((root, query, cb) -> cb.greaterThanOrEqualTo(root.get("startAt"), dayStart));
            spec = spec.and((root, query, cb) -> cb.lessThan(root.get("startAt"), dayEnd));
        }

        Sort defaultSort = Sort.by(Sort.Order.asc("startAt"), Sort.Order.asc("id"));
        Pageable effectivePageable = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), defaultSort);

        Page<Appointment> page = appointmentRepository.findAll(spec, effectivePageable);
        return PageResponse.from(page.map(AppointmentResponse::from));
    }

    @PreAuthorize("hasAnyRole('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PATIENT')")
    public AppointmentResponse getAppointment(AuthenticatedUser viewer, Long id) {
        Appointment appointment = appointmentRepository.findById(id)
                .orElseThrow(ManagementException::missing);

        if (viewer.role() == Role.DOCTOR) {
            if (!appointment.getDoctor().getUser().getId().equals(viewer.id())) {
                throw ManagementException.missing();
            }
        } else if (viewer.role() == Role.PATIENT) {
            if (appointment.getPatient().getUser() == null || !appointment.getPatient().getUser().getId().equals(viewer.id())) {
                throw ManagementException.missing();
            }
        }

        return AppointmentResponse.from(appointment);
    }

    private Long parsePositiveLong(String value, String errorMessage) {
        if (value == null || value.isBlank()) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", errorMessage);
        }
        try {
            long parsed = Long.parseLong(value.trim());
            if (parsed <= 0) {
                throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", errorMessage);
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", errorMessage);
        }
    }

    private String computeFingerprint(Long patientId, Long doctorId, Long scheduleId, Instant startAt, Instant endAt, String reason) {
        String canonical = patientId + ":" + doctorId + ":" + scheduleId + ":" + startAt.toString() + ":" + endAt.toString() + ":" + (reason == null ? "" : reason.trim());
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(canonical.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm not available", e);
        }
    }

    private String generateAppointmentCode() {
        for (int i = 0; i < 10; i++) {
            int num = random.nextInt(1_000_000);
            String code = String.format("APP%06d", num);
            if (!appointmentRepository.existsByAppointmentCode(code)) {
                return code;
            }
        }
        return "APP" + System.currentTimeMillis();
    }
}

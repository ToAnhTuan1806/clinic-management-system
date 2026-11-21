package com.clinicmanagement.service;

import com.clinicmanagement.dto.DoctorScheduleCreateRequest;
import com.clinicmanagement.dto.DoctorSchedulePatchRequest;
import com.clinicmanagement.dto.DoctorScheduleResponse;
import com.clinicmanagement.dto.PageResponse;
import com.clinicmanagement.dto.ScheduleSlotResponse;
import com.clinicmanagement.entity.Doctor;
import com.clinicmanagement.entity.DoctorSchedule;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.ScheduleStatus;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.DoctorRepository;
import com.clinicmanagement.repository.DoctorScheduleRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class DoctorScheduleService {
    public static final ZoneId ZONE_VN = ZoneId.of("Asia/Ho_Chi_Minh");
    private static final Set<Integer> VALID_SLOT_MINUTES = Set.of(15, 30, 60);

    private final DoctorScheduleRepository scheduleRepository;
    private final DoctorRepository doctorRepository;

    public DoctorScheduleService(DoctorScheduleRepository scheduleRepository, DoctorRepository doctorRepository) {
        this.scheduleRepository = scheduleRepository;
        this.doctorRepository = doctorRepository;
    }

    @Transactional
    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST')")
    public DoctorScheduleResponse create(DoctorScheduleCreateRequest request) {
        if (request.doctorId() == null || request.doctorId() <= 0) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Doctor ID must be a positive integer.");
        }
        if (request.startAt() == null || request.endAt() == null) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Start and end times are required.");
        }
        if (!request.startAt().isAfter(Instant.now())) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Schedule start time must be in the future.");
        }
        if (!request.endAt().isAfter(request.startAt())) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Schedule start time must be before end time.");
        }

        LocalDate startDateLocal = request.startAt().atZone(ZONE_VN).toLocalDate();
        LocalDate endDateLocal = request.endAt().atZone(ZONE_VN).toLocalDate();
        if (!startDateLocal.equals(endDateLocal)) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Schedule must be within the same calendar day in Asia/Ho_Chi_Minh.");
        }

        int slotMinutes = request.slotMinutes() != null ? request.slotMinutes() : 30;
        if (!VALID_SLOT_MINUTES.contains(slotMinutes)) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Slot duration must be 15, 30, or 60 minutes.");
        }

        long durationMinutes = Duration.between(request.startAt(), request.endAt()).toMinutes();
        if (durationMinutes < slotMinutes) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Schedule duration cannot be shorter than slot duration.");
        }

        Doctor doctor = doctorRepository.findLocked(request.doctorId())
                .orElseThrow(() -> new ManagementException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Doctor not found."));

        if (!doctor.isActive()) {
            throw new ManagementException(HttpStatus.CONFLICT, "DOCTOR_INACTIVE", "Doctor is not active.");
        }
        if (doctor.getUser().getStatus() != UserStatus.ACTIVE) {
            throw new ManagementException(HttpStatus.CONFLICT, "USER_NOT_ACTIVE", "Doctor account is not active.");
        }

        ScheduleStatus status = request.status() != null ? request.status() : ScheduleStatus.ACTIVE;
        if (status == ScheduleStatus.ACTIVE) {
            boolean overlaps = scheduleRepository.existsOverlapping(
                    doctor.getId(), ScheduleStatus.ACTIVE, request.startAt(), request.endAt(), null);
            if (overlaps) {
                throw new ManagementException(HttpStatus.CONFLICT, "SCHEDULE_OVERLAP", "Doctor schedule overlaps with an existing active schedule.");
            }
        }

        DoctorSchedule schedule = new DoctorSchedule(doctor, startDateLocal, request.startAt(), request.endAt(), slotMinutes, status);
        return DoctorScheduleResponse.from(scheduleRepository.saveAndFlush(schedule));
    }

    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST','DOCTOR')")
    public DoctorScheduleResponse get(AuthenticatedUser viewer, Long id) {
        DoctorSchedule schedule = scheduleRepository.findById(id).orElseThrow(ManagementException::missing);
        if (viewer.role() == Role.DOCTOR) {
            Doctor doctor = doctorRepository.findByUserId(viewer.id())
                    .orElseThrow(() -> new ManagementException(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Doctor profile not found."));
            if (!schedule.getDoctor().getId().equals(doctor.getId())) {
                throw new ManagementException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Doctor schedule not found.");
            }
        } else if (viewer.role() == Role.PATIENT) {
            throw new ManagementException(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Patients cannot access schedule management.");
        }
        return DoctorScheduleResponse.from(schedule);
    }

    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST','DOCTOR')")
    public PageResponse<DoctorScheduleResponse> list(
            AuthenticatedUser viewer,
            Long doctorId,
            LocalDate workDate,
            LocalDate from,
            LocalDate to,
            ScheduleStatus status,
            Pageable pageable
    ) {
        if (viewer.role() == Role.PATIENT) {
            throw new ManagementException(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Patients cannot access schedule management.");
        }
        Long effectiveDoctorId = doctorId;
        if (viewer.role() == Role.DOCTOR) {
            Doctor doctor = doctorRepository.findByUserId(viewer.id())
                    .orElseThrow(() -> new ManagementException(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Doctor profile not found."));
            if (doctorId != null && !doctorId.equals(doctor.getId())) {
                throw new ManagementException(HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Doctors can only view their own schedules.");
            }
            effectiveDoctorId = doctor.getId();
        }

        Specification<DoctorSchedule> spec = (root, query, cb) -> cb.conjunction();
        if (effectiveDoctorId != null) {
            final Long targetDoctorId = effectiveDoctorId;
            spec = spec.and((root, query, cb) -> cb.equal(root.get("doctor").get("id"), targetDoctorId));
        }
        if (workDate != null) {
            spec = spec.and((root, query, cb) -> cb.equal(root.get("workDate"), workDate));
        }
        if (from != null) {
            spec = spec.and((root, query, cb) -> cb.greaterThanOrEqualTo(root.get("workDate"), from));
        }
        if (to != null) {
            spec = spec.and((root, query, cb) -> cb.lessThanOrEqualTo(root.get("workDate"), to));
        }
        if (status != null) {
            spec = spec.and((root, query, cb) -> cb.equal(root.get("status"), status));
        }

        Sort defaultSort = Sort.by(Sort.Order.asc("workDate"), Sort.Order.asc("startAt"), Sort.Order.asc("id"));
        Pageable effectivePageable = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), defaultSort);

        Page<DoctorSchedule> page = scheduleRepository.findAll(spec, effectivePageable);
        return PageResponse.from(page.map(DoctorScheduleResponse::from));
    }

    @Transactional
    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST')")
    public DoctorScheduleResponse patch(Long id, DoctorSchedulePatchRequest request) {
        if (request == null || request.isEmpty()) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Request body contains no fields to update.");
        }

        DoctorSchedule schedule = scheduleRepository.findById(id).orElseThrow(ManagementException::missing);

        Doctor doctor = doctorRepository.findLocked(schedule.getDoctor().getId())
                .orElseThrow(ManagementException::missing);

        if (!schedule.getStartAt().isAfter(Instant.now())) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Cannot modify a schedule that has already started or is in the past.");
        }

        Instant targetStart = request.startAt() != null ? request.startAt() : schedule.getStartAt();
        Instant targetEnd = request.endAt() != null ? request.endAt() : schedule.getEndAt();
        int targetSlotMinutes = request.slotMinutes() != null ? request.slotMinutes() : schedule.getSlotMinutes();
        ScheduleStatus targetStatus = request.status() != null ? request.status() : schedule.getStatus();

        if (request.startAt() != null && !targetStart.isAfter(Instant.now())) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Schedule start time must be in the future.");
        }
        if (!targetEnd.isAfter(targetStart)) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Schedule start time must be before end time.");
        }

        LocalDate startDateLocal = targetStart.atZone(ZONE_VN).toLocalDate();
        LocalDate endDateLocal = targetEnd.atZone(ZONE_VN).toLocalDate();
        if (!startDateLocal.equals(endDateLocal)) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Schedule must be within the same calendar day in Asia/Ho_Chi_Minh.");
        }

        if (!VALID_SLOT_MINUTES.contains(targetSlotMinutes)) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Slot duration must be 15, 30, or 60 minutes.");
        }

        long durationMinutes = Duration.between(targetStart, targetEnd).toMinutes();
        if (durationMinutes < targetSlotMinutes) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Schedule duration cannot be shorter than slot duration.");
        }

        if (targetStatus == ScheduleStatus.ACTIVE) {
            boolean overlaps = scheduleRepository.existsOverlapping(
                    doctor.getId(), ScheduleStatus.ACTIVE, targetStart, targetEnd, schedule.getId());
            if (overlaps) {
                throw new ManagementException(HttpStatus.CONFLICT, "SCHEDULE_OVERLAP", "Doctor schedule overlaps with an existing active schedule.");
            }
        }

        schedule.update(startDateLocal, targetStart, targetEnd, targetSlotMinutes, targetStatus);
        return DoctorScheduleResponse.from(scheduleRepository.saveAndFlush(schedule));
    }

    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST','DOCTOR','PATIENT')")
    public List<ScheduleSlotResponse> getSlots(Long doctorId, LocalDate date, LocalDate from, LocalDate to) {
        Doctor doctor = doctorRepository.findById(doctorId).orElseThrow(ManagementException::missing);
        if (!doctor.isActive() || doctor.getUser().getStatus() != UserStatus.ACTIVE) {
            throw new ManagementException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Doctor not found or inactive.");
        }

        LocalDate fromDate;
        LocalDate toDate;
        if (date != null) {
            fromDate = date;
            toDate = date;
        } else if (from != null && to != null) {
            fromDate = from;
            toDate = to;
        } else if (from != null) {
            fromDate = from;
            toDate = from.plusDays(30);
        } else {
            LocalDate today = LocalDate.now(ZONE_VN);
            fromDate = today;
            toDate = today.plusDays(14);
        }

        if (fromDate.isAfter(toDate)) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "'from' date must be before or equal to 'to' date.");
        }

        List<DoctorSchedule> schedules = scheduleRepository.findByDoctorIdAndStatusAndWorkDateBetweenOrderByStartAtAsc(
                doctorId, ScheduleStatus.ACTIVE, fromDate, toDate);

        List<ScheduleSlotResponse> slots = new ArrayList<>();
        Instant now = Instant.now();

        for (DoctorSchedule s : schedules) {
            Instant cur = s.getStartAt();
            Instant end = s.getEndAt();
            Duration slotDur = Duration.ofMinutes(s.getSlotMinutes());

            while (cur.plus(slotDur).compareTo(end) <= 0) {
                Instant slotStart = cur;
                Instant slotEnd = cur.plus(slotDur);
                if (slotStart.isAfter(now)) {
                    slots.add(new ScheduleSlotResponse(
                            s.getId().toString(),
                            doctorId.toString(),
                            s.getWorkDate(),
                            slotStart,
                            slotEnd,
                            true
                    ));
                }
                cur = slotEnd;
            }
        }

        return slots;
    }
}

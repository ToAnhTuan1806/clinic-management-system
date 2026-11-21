package com.clinicmanagement.controller;

import com.clinicmanagement.dto.ApiResponse;
import com.clinicmanagement.dto.DoctorScheduleCreateRequest;
import com.clinicmanagement.dto.DoctorSchedulePatchRequest;
import com.clinicmanagement.dto.DoctorScheduleResponse;
import com.clinicmanagement.dto.PageResponse;
import com.clinicmanagement.dto.ScheduleSlotResponse;
import com.clinicmanagement.entity.ScheduleStatus;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.DoctorScheduleService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import java.net.URI;
import java.time.LocalDate;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class DoctorScheduleController {
    private final DoctorScheduleService schedules;

    public DoctorScheduleController(DoctorScheduleService schedules) {
        this.schedules = schedules;
    }

    @PostMapping("/doctor-schedules")
    public ResponseEntity<ApiResponse<DoctorScheduleResponse>> create(
            @Valid @RequestBody DoctorScheduleCreateRequest request) {
        DoctorScheduleResponse created = schedules.create(request);
        return ResponseEntity.created(URI.create("/api/v1/doctor-schedules/" + created.id()))
                .body(new ApiResponse<>(created));
    }

    @GetMapping("/doctor-schedules")
    public ApiResponse<PageResponse<DoctorScheduleResponse>> list(
            @AuthenticationPrincipal AuthenticatedUser viewer,
            @RequestParam(required = false) Long doctorId,
            @RequestParam(required = false) LocalDate workDate,
            @RequestParam(required = false) LocalDate from,
            @RequestParam(required = false) LocalDate to,
            @RequestParam(required = false) ScheduleStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return new ApiResponse<>(schedules.list(viewer, doctorId, workDate, from, to, status, PageRequest.of(page, size)));
    }

    @GetMapping("/doctor-schedules/{id}")
    public ApiResponse<DoctorScheduleResponse> get(
            @AuthenticationPrincipal AuthenticatedUser viewer,
            @PathVariable @Positive Long id) {
        return new ApiResponse<>(schedules.get(viewer, id));
    }

    @PatchMapping("/doctor-schedules/{id}")
    public ApiResponse<DoctorScheduleResponse> patch(
            @PathVariable @Positive Long id,
            @Valid @RequestBody DoctorSchedulePatchRequest request) {
        return new ApiResponse<>(schedules.patch(id, request));
    }

    @GetMapping("/doctors/{id}/schedule-slots")
    public ApiResponse<List<ScheduleSlotResponse>> getSlots(
            @PathVariable @Positive Long id,
            @RequestParam(required = false) LocalDate date,
            @RequestParam(required = false) LocalDate from,
            @RequestParam(required = false) LocalDate to) {
        return new ApiResponse<>(schedules.getSlots(id, date, from, to));
    }
}

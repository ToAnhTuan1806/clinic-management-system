package com.clinicmanagement.controller;

import com.clinicmanagement.dto.*;
import com.clinicmanagement.entity.AppointmentStatus;
import com.clinicmanagement.security.AuthenticatedUser;
import com.clinicmanagement.service.AppointmentService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import java.net.URI;
import java.time.LocalDate;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/appointments")
public class AppointmentController {
    private final AppointmentService appointmentService;

    public AppointmentController(AppointmentService appointmentService) {
        this.appointmentService = appointmentService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<AppointmentResponse>> book(
            @AuthenticationPrincipal AuthenticatedUser actor,
            @Valid @RequestBody AppointmentBookRequest request) {
        AppointmentBookingResult result = appointmentService.bookAppointment(actor, request);
        if (result.replayed()) {
            return ResponseEntity.ok(new ApiResponse<>(result.appointment()));
        }
        return ResponseEntity.created(URI.create("/api/v1/appointments/" + result.appointment().id()))
                .body(new ApiResponse<>(result.appointment()));
    }

    @GetMapping
    public ApiResponse<PageResponse<AppointmentResponse>> list(
            @AuthenticationPrincipal AuthenticatedUser viewer,
            @RequestParam(required = false) Long doctorId,
            @RequestParam(required = false) Long patientId,
            @RequestParam(required = false) LocalDate date,
            @RequestParam(required = false) AppointmentStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return new ApiResponse<>(appointmentService.listAppointments(viewer, doctorId, patientId, date, status, PageRequest.of(page, size)));
    }

    @GetMapping("/{id}")
    public ApiResponse<AppointmentResponse> get(
            @AuthenticationPrincipal AuthenticatedUser viewer,
            @PathVariable @Positive Long id) {
        return new ApiResponse<>(appointmentService.getAppointment(viewer, id));
    }
}

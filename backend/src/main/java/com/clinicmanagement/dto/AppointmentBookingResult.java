package com.clinicmanagement.dto;

public record AppointmentBookingResult(
        AppointmentResponse appointment,
        boolean replayed
) {}

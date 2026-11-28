package com.clinicmanagement.dto;

import com.clinicmanagement.entity.AppointmentStatus;
import java.time.LocalDate;
import java.util.Map;

public record DashboardSummaryResponse(LocalDate from, LocalDate to, String timezone, long totalAppointments,
                                       Map<AppointmentStatus, Long> appointmentsByStatus, long checkedInCount,
                                       long completedCount, long uniquePatients) {}

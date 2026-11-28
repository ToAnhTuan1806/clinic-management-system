package com.clinicmanagement.entity;

public enum NotificationType {
    APPOINTMENT_CREATED("Appointment booked"),
    APPOINTMENT_RESCHEDULED("Appointment rescheduled"),
    APPOINTMENT_CANCELLED("Appointment cancelled"),
    APPOINTMENT_CONFIRMED("Appointment confirmed");

    private final String title;
    NotificationType(String title) { this.title = title; }
    public String title() { return title; }
}

package com.clinicmanagement.dto;

import com.clinicmanagement.entity.Notification;
import com.clinicmanagement.entity.NotificationType;
import java.time.Instant;

public record NotificationResponse(String id, String appointmentId, String appointmentCode, NotificationType eventType,
                                   String title, String body, Instant createdAt, Instant readAt) {
    public static NotificationResponse from(Notification notification) {
        var appointment = notification.getAppointment();
        return new NotificationResponse(notification.getId().toString(), appointment.getId().toString(),
                appointment.getAppointmentCode(), notification.getEventType(), notification.getTitle(),
                notification.getBody(), notification.getCreatedAt(), notification.getReadAt());
    }
}

package com.clinicmanagement.service;

import com.clinicmanagement.dto.NotificationPageResponse;
import com.clinicmanagement.dto.NotificationResponse;
import com.clinicmanagement.entity.*;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.NotificationRepository;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.Clock;
import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.data.domain.Sort;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class NotificationService {
    private final NotificationRepository notifications;
    private final UserRepository users;
    private final Clock clock;
    public NotificationService(NotificationRepository notifications, UserRepository users, Clock clock) {
        this.notifications = notifications;
        this.users = users;
        this.clock = clock;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST','DOCTOR','PATIENT')")
    public NotificationPageResponse list(AuthenticatedUser viewer, int page, int size) {
        var paging = CatalogQueries.page(page, size, "createdAt")
                .withSort(Sort.by(Sort.Direction.DESC, "createdAt", "id"));
        var result = notifications.findByRecipientId(viewer.id(), paging);
        return new NotificationPageResponse(result.map(NotificationResponse::from).getContent(), page, size,
                result.getTotalElements(), result.getTotalPages(), notifications.countByRecipientIdAndReadAtIsNull(viewer.id()));
    }

    @Transactional
    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST','DOCTOR','PATIENT')")
    public NotificationResponse read(AuthenticatedUser viewer, Long id) {
        var notification = notifications.findOwnedLocked(id, viewer.id()).orElseThrow(ManagementException::missing);
        notification.markRead(clock.instant());
        notifications.flush();
        return NotificationResponse.from(notification);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void appointmentChanged(Appointment appointment, NotificationType type, User previousDoctor) {
        Set<Long> patientIds = new LinkedHashSet<>();
        Set<Long> doctorIds = new LinkedHashSet<>();
        if (appointment.getPatient().getUser() != null) patientIds.add(appointment.getPatient().getUser().getId());
        doctorIds.add(appointment.getDoctor().getUser().getId());
        if (previousDoctor != null) doctorIds.add(previousDoctor.getId());
        Set<Long> recipients = new LinkedHashSet<>(patientIds);
        recipients.addAll(doctorIds);
        if (appointment.getVersion() == null) {
            throw new IllegalStateException("Appointment must be flushed before publishing notifications.");
        }
        String eventKey = "appointment:" + appointment.getId() + ":version:" + appointment.getVersion() + ":event:" + type.name();
        try {
            for (User user : users.findActiveNotificationRecipients(recipients)) {
                if ((patientIds.contains(user.getId()) && user.getRole() == Role.PATIENT)
                        || (doctorIds.contains(user.getId()) && user.getRole() == Role.DOCTOR)) {
                    notifications.save(new Notification(user, appointment, type, eventKey, clock.instant()));
                }
            }
            notifications.flush();
        } catch (DataIntegrityViolationException exception) {
            throw ManagementException.conflict("NOTIFICATION_CONFLICT", "Appointment notification could not be saved.");
        }
    }
}

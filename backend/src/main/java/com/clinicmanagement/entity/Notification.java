package com.clinicmanagement.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

@Entity
@Table(name = "notifications", uniqueConstraints =
        @UniqueConstraint(name = "uk_notifications_recipient_event", columnNames = {"recipient_user_id", "event_key"}))
public class Notification {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "recipient_user_id", nullable = false, updatable = false)
    private User recipient;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "appointment_id", nullable = false, updatable = false)
    private Appointment appointment;
    @Column(name = "event_key", nullable = false, updatable = false, length = 128)
    private String eventKey;
    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false, updatable = false, length = 32)
    private NotificationType eventType;
    @Column(nullable = false, updatable = false, length = 160)
    private String title;
    @Column(name = "body", updatable = false, length = 500)
    private String body;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "read_at")
    private Instant readAt;

    protected Notification() {}

    public Notification(User recipient, Appointment appointment, NotificationType type, String eventKey, Instant now) {
        this.recipient = recipient;
        this.appointment = appointment;
        this.eventType = type;
        this.eventKey = eventKey;
        this.title = type.title();
        this.body = type.title() + ": " + appointment.getAppointmentCode();
        this.createdAt = now.truncatedTo(ChronoUnit.MICROS);
    }

    public void markRead(Instant now) {
        if (readAt == null) readAt = now.truncatedTo(ChronoUnit.MICROS);
    }
    public Long getId() { return id; }
    public Appointment getAppointment() { return appointment; }
    public NotificationType getEventType() { return eventType; }
    public String getTitle() { return title; }
    public String getBody() { return body; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getReadAt() { return readAt; }
}

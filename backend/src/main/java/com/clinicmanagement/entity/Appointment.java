package com.clinicmanagement.entity;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;

@Entity
@Table(name = "appointments")
public class Appointment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "appointment_code", nullable = false, unique = true, length = 32)
    private String appointmentCode;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "patient_id", nullable = false)
    private Patient patient;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "doctor_id", nullable = false)
    private Doctor doctor;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "schedule_id", nullable = false)
    private DoctorSchedule schedule;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by", nullable = false)
    private User createdBy;

    @Column(name = "start_at_utc", nullable = false)
    private Instant startAt;

    @Column(name = "end_at_utc", nullable = false)
    private Instant endAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private AppointmentStatus status;

    @Column(name = "reason", length = 500)
    private String reason;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cancelled_by")
    private User cancelledBy;

    @Column(name = "cancellation_reason", length = 255)
    private String cancellationReason;

    @Column(name = "rescheduled_at")
    private Instant rescheduledAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "rescheduled_by")
    private User rescheduledBy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "previous_schedule_id")
    private DoctorSchedule previousSchedule;

    @Column(name = "previous_start_at_utc")
    private Instant previousStartAtUtc;

    @Column(name = "request_key", nullable = false, length = 64)
    private String requestKey;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "request_fingerprint", nullable = false, length = 64)
    private String requestFingerprint;

    @Column(name = "active_slot_start_utc", insertable = false, updatable = false)
    private Instant activeSlotStartUtc;

    @Version
    @Column(name = "version", nullable = false)
    private Long version = 0L;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Appointment() {
    }

    public Appointment(String appointmentCode, Patient patient, Doctor doctor, DoctorSchedule schedule,
                       User createdBy, String requestKey, String requestFingerprint,
                       Instant startAt, Instant endAt, AppointmentStatus status, String reason) {
        this.appointmentCode = appointmentCode;
        this.patient = patient;
        this.doctor = doctor;
        this.schedule = schedule;
        this.createdBy = createdBy;
        this.requestKey = requestKey;
        this.requestFingerprint = requestFingerprint;
        this.startAt = startAt;
        this.endAt = endAt;
        this.status = status != null ? status : AppointmentStatus.PENDING;
        this.reason = reason;
        this.createdAt = Instant.now();
        this.updatedAt = Instant.now();
        this.version = 0L;
    }

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (updatedAt == null) {
            updatedAt = Instant.now();
        }
        if (status == null) {
            status = AppointmentStatus.PENDING;
        }
        if (version == null) {
            version = 0L;
        }
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public String getAppointmentCode() {
        return appointmentCode;
    }

    public Patient getPatient() {
        return patient;
    }

    public Doctor getDoctor() {
        return doctor;
    }

    public DoctorSchedule getSchedule() {
        return schedule;
    }

    public User getCreatedBy() {
        return createdBy;
    }

    public String getRequestKey() {
        return requestKey;
    }

    public String getRequestFingerprint() {
        return requestFingerprint;
    }

    public Instant getStartAt() {
        return startAt;
    }

    public Instant getEndAt() {
        return endAt;
    }

    public AppointmentStatus getStatus() {
        return status;
    }

    public String getReason() {
        return reason;
    }

    public Instant getCancelledAt() {
        return cancelledAt;
    }

    public User getCancelledBy() {
        return cancelledBy;
    }

    public String getCancellationReason() {
        return cancellationReason;
    }

    public Instant getRescheduledAt() {
        return rescheduledAt;
    }

    public User getRescheduledBy() {
        return rescheduledBy;
    }

    public DoctorSchedule getPreviousSchedule() {
        return previousSchedule;
    }

    public Instant getPreviousStartAtUtc() {
        return previousStartAtUtc;
    }

    public Instant getActiveSlotStartUtc() {
        return activeSlotStartUtc;
    }

    public Long getVersion() {
        return version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void cancel() {
        this.status = AppointmentStatus.CANCELLED;
        this.updatedAt = Instant.now();
    }

    public void cancel(String cancellationReason) {
        cancel(null, cancellationReason);
    }

    public void cancel(User actor, String cancellationReason) {
        this.status = AppointmentStatus.CANCELLED;
        if (cancellationReason != null && !cancellationReason.isBlank()) {
            this.cancellationReason = cancellationReason.trim();
        }
        this.cancelledAt = Instant.now();
        this.cancelledBy = actor;
        this.updatedAt = Instant.now();
    }

    public void reschedule(DoctorSchedule newSchedule, Instant newStartAt, Instant newEndAt) {
        reschedule(null, newSchedule, newStartAt, newEndAt);
    }

    public void reschedule(User actor, DoctorSchedule newSchedule, Instant newStartAt, Instant newEndAt) {
        this.rescheduledAt = Instant.now();
        this.rescheduledBy = actor;
        this.previousSchedule = this.schedule;
        this.previousStartAtUtc = this.startAt;
        this.schedule = newSchedule;
        this.startAt = newStartAt;
        this.endAt = newEndAt;
        this.status = AppointmentStatus.PENDING;
        this.updatedAt = Instant.now();
    }
}

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
}

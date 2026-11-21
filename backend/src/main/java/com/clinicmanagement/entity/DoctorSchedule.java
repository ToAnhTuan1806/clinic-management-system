package com.clinicmanagement.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "doctor_schedules")
public class DoctorSchedule {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "doctor_id", nullable = false)
    private Doctor doctor;

    @Column(name = "work_date", nullable = false)
    private LocalDate workDate;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "start_at_utc", nullable = false)
    private Instant startAt;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "end_at_utc", nullable = false)
    private Instant endAt;

    @Column(name = "slot_minutes", nullable = false)
    private short slotMinutes = 30;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 16)
    private ScheduleStatus status = ScheduleStatus.ACTIVE;

    @Version
    @Column(nullable = false)
    private Long version = 0L;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected DoctorSchedule() { }

    public DoctorSchedule(Doctor doctor, LocalDate workDate, Instant startAt, Instant endAt, int slotMinutes, ScheduleStatus status) {
        this.doctor = doctor;
        this.workDate = workDate;
        this.startAt = startAt;
        this.endAt = endAt;
        this.slotMinutes = (short) slotMinutes;
        this.status = status;
    }

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public void update(LocalDate workDate, Instant startAt, Instant endAt, int slotMinutes, ScheduleStatus status) {
        this.workDate = workDate;
        this.startAt = startAt;
        this.endAt = endAt;
        this.slotMinutes = (short) slotMinutes;
        this.status = status;
    }

    public Long getId() { return id; }
    public Doctor getDoctor() { return doctor; }
    public LocalDate getWorkDate() { return workDate; }
    public Instant getStartAt() { return startAt; }
    public Instant getEndAt() { return endAt; }
    public int getSlotMinutes() { return slotMinutes; }
    public ScheduleStatus getStatus() { return status; }
    public Long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}

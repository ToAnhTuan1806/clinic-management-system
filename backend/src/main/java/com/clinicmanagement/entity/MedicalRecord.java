package com.clinicmanagement.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

@Entity
@Table(name = "medical_records")
public class MedicalRecord {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "appointment_id", nullable = false, unique = true, updatable = false)
    private Appointment appointment;

    @Column(columnDefinition = "TEXT")
    private String symptoms;
    @Column(columnDefinition = "TEXT")
    private String diagnosis;
    @Column(columnDefinition = "TEXT")
    private String notes;
    @Column(columnDefinition = "TEXT")
    private String conclusion;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by", nullable = false, updatable = false)
    private User createdBy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "completed_by")
    private User completedBy;

    private Instant completedAt;
    private Instant releasedAt;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "released_by")
    private User releasedBy;
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
    @Column(nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    protected MedicalRecord() {}

    public MedicalRecord(Appointment appointment, User actor, Instant now) {
        this.appointment = appointment;
        this.createdBy = actor;
        this.createdAt = now.truncatedTo(ChronoUnit.MICROS);
        this.updatedAt = createdAt;
    }

    public void update(String symptoms, String diagnosis, String notes, String conclusion, Instant now) {
        if (symptoms != null) this.symptoms = normalize(symptoms);
        if (diagnosis != null) this.diagnosis = normalize(diagnosis);
        if (notes != null) this.notes = normalize(notes);
        if (conclusion != null) this.conclusion = normalize(conclusion);
        touch(now);
    }

    public boolean hasRequiredContent() {
        return symptoms != null && !symptoms.isBlank() && diagnosis != null && !diagnosis.isBlank()
                && conclusion != null && !conclusion.isBlank();
    }

    public void complete(User actor, Instant now) {
        touch(now);
        completedAt = updatedAt;
        completedBy = actor;
    }

    private void touch(Instant now) {
        Instant timestamp = now.truncatedTo(ChronoUnit.MICROS);
        updatedAt = timestamp.isAfter(updatedAt) ? timestamp : updatedAt.plus(1, ChronoUnit.MICROS);
    }

    public void release(User actor, Instant now) {
        touch(now);
        releasedAt = updatedAt;
        releasedBy = actor;
    }

    public Instant getReleasedAt() { return releasedAt; }
    public User getReleasedBy() { return releasedBy; }

    private static String normalize(String value) {
        return value.isBlank() ? null : value.strip();
    }

    public Long getId() { return id; }
    public Appointment getAppointment() { return appointment; }
    public String getSymptoms() { return symptoms; }
    public String getDiagnosis() { return diagnosis; }
    public String getNotes() { return notes; }
    public String getConclusion() { return conclusion; }
    public User getCreatedBy() { return createdBy; }
    public User getCompletedBy() { return completedBy; }
    public Instant getCompletedAt() { return completedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Long getVersion() { return version; }
}

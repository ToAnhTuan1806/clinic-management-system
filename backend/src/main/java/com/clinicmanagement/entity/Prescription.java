package com.clinicmanagement.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "prescriptions")
public class Prescription {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "medical_record_id", nullable = false, unique = true, updatable = false)
    private MedicalRecord medicalRecord;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by", nullable = false, updatable = false)
    private User createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @OneToMany(mappedBy = "prescription", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC")
    private List<PrescriptionItem> items = new ArrayList<>();

    protected Prescription() {}

    public Prescription(MedicalRecord medicalRecord, User createdBy, Instant now) {
        this.medicalRecord = medicalRecord;
        this.createdBy = createdBy;
        this.createdAt = now.truncatedTo(ChronoUnit.MICROS);
        this.updatedAt = createdAt;
    }

    public void addItem(PrescriptionItem item) {
        item.setPrescription(this);
        this.items.add(item);
    }

    public void clearItems() {
        this.items.clear();
    }

    public void touch(Instant now) {
        Instant timestamp = now.truncatedTo(ChronoUnit.MICROS);
        this.updatedAt = timestamp.isAfter(this.updatedAt) ? timestamp : this.updatedAt.plus(1, ChronoUnit.MICROS);
    }

    public Long getId() { return id; }
    public MedicalRecord getMedicalRecord() { return medicalRecord; }
    public User getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public List<PrescriptionItem> getItems() { return items; }
}

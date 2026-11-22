package com.clinicmanagement.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "prescription_items")
public class PrescriptionItem {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "prescription_id", nullable = false)
    private Prescription prescription;

    @Column(name = "medication_name", nullable = false, length = 200)
    private String medicationName;

    @Column(nullable = false)
    private Integer quantity;

    @Column(nullable = false, length = 100)
    private String dosage;

    @Column(nullable = false, length = 100)
    private String frequency;

    @Column(name = "duration_days", nullable = false)
    private Integer durationDays;

    @Column(length = 1000)
    private String instructions;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder;

    protected PrescriptionItem() {}

    public PrescriptionItem(String medicationName, Integer quantity, String dosage,
                          String frequency, Integer durationDays, String instructions, Integer sortOrder) {
        this.medicationName = medicationName;
        this.quantity = quantity;
        this.dosage = dosage;
        this.frequency = frequency;
        this.durationDays = durationDays;
        this.instructions = instructions;
        this.sortOrder = sortOrder;
    }

    public Long getId() { return id; }
    public Prescription getPrescription() { return prescription; }
    public void setPrescription(Prescription prescription) { this.prescription = prescription; }
    public String getMedicationName() { return medicationName; }
    public Integer getQuantity() { return quantity; }
    public String getDosage() { return dosage; }
    public String getFrequency() { return frequency; }
    public Integer getDurationDays() { return durationDays; }
    public String getInstructions() { return instructions; }
    public Integer getSortOrder() { return sortOrder; }
    public void setSortOrder(Integer sortOrder) { this.sortOrder = sortOrder; }
}

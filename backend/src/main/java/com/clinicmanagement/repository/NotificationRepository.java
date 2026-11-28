package com.clinicmanagement.repository;

import com.clinicmanagement.entity.Notification;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.*;

public interface NotificationRepository extends JpaRepository<Notification, Long> {
    @EntityGraph(attributePaths = "appointment")
    Page<Notification> findByRecipientId(Long recipientId, Pageable pageable);

    long countByRecipientIdAndReadAtIsNull(Long recipientId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select n from Notification n where n.id = :id and n.recipient.id = :recipientId")
    Optional<Notification> findOwnedLocked(Long id, Long recipientId);
}

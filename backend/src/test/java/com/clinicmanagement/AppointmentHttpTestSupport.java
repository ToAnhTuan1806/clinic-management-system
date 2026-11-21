package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.clinicmanagement.dto.*;
import com.clinicmanagement.entity.*;
import com.clinicmanagement.repository.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@ExtendWith(OutputCaptureExtension.class)
abstract class AppointmentHttpTestSupport extends TestSecurityProperties {
    @LocalServerPort
    private int port;
    @Autowired
    private ObjectMapper mapper;
    @Autowired
    private UserRepository users;
    @Autowired
    private SpecialtyRepository specialties;
    @Autowired
    private DoctorRepository doctors;
    @Autowired
    private PatientRepository patients;
    @Autowired
    private DoctorScheduleRepository schedules;
    @Autowired
    private AppointmentRepository appointments;
    @Autowired
    private PasswordEncoder passwords;
    @Autowired
    private DataSource dataSource;
    @Autowired
    private JdbcTemplate jdbc;

    private final Map<Role, User> actors = new EnumMap<>(Role.class);
    private final Map<Role, String> tokens = new EnumMap<>(Role.class);
    private final List<String> secrets = new ArrayList<>();
    private String password;
    private String hash;

    private Specialty specialty;
    private Doctor mainDoctor;
    private Doctor secondDoctor;
    private Patient mainPatient;
    private Patient secondPatient;
    private DoctorSchedule mainSchedule;

    @BeforeEach
    void prepare() throws Exception {
        try (var connection = dataSource.getConnection()) {
            if (!"H2".equals(connection.getMetaData().getDatabaseProductName())) {
                MySqlTestDatabase.requireIsolatedUrl(connection.getMetaData().getURL());
            }
        }
        jdbc.execute("DELETE FROM appointments");
        jdbc.execute("DELETE FROM doctor_schedules");
        patients.deleteAll();
        doctors.deleteAll();
        specialties.deleteAll();
        users.deleteAll();
        actors.clear();
        tokens.clear();
        secrets.clear();
        password = UUID.randomUUID().toString();
        hash = passwords.encode(password);
        secrets.add(password);
        secrets.add(hash);

        for (Role role : Role.values()) {
            actors.put(role, seed(role, "User " + role));
        }

        specialty = specialties.saveAndFlush(new Specialty("CARD", "Cardiology", "Heart care", true));
        mainDoctor = doctors.saveAndFlush(new Doctor(actors.get(Role.DOCTOR), specialty, "DOC-01", "LIC-01", "Bio", true));

        User doctorUser2 = seed(Role.DOCTOR, "Doctor Beta");
        secondDoctor = doctors.saveAndFlush(new Doctor(doctorUser2, specialty, "DOC-02", "LIC-02", "Bio Beta", true));

        mainPatient = patients.saveAndFlush(new Patient(actors.get(Role.PATIENT), "PAT-001", "Main Patient",
                LocalDate.of(1990, 1, 1), Sex.MALE, "0901234567", "Hanoi", true));

        User patientUser2 = seed(Role.PATIENT, "Second Patient");
        secondPatient = patients.saveAndFlush(new Patient(patientUser2, "PAT-002", "Second Patient",
                LocalDate.of(1992, 2, 2), Sex.FEMALE, "0909998888", "Danang", true));

        Instant start = futureTime(3, 8, 0);
        Instant end = futureTime(3, 12, 0);
        LocalDate workDate = start.atZone(ZoneId.of("Asia/Ho_Chi_Minh")).toLocalDate();
        mainSchedule = schedules.saveAndFlush(new DoctorSchedule(mainDoctor, workDate, start, end, 30, ScheduleStatus.ACTIVE));
    }

    @AfterEach
    void noCredentialOutput(CapturedOutput output) {
        for (String secret : secrets) {
            assertThat(output.getAll().contains(secret)).as("credential must not be logged").isFalse();
        }
    }

    private Instant futureTime(int plusDays, int hour, int minute) {
        LocalDate targetDate = LocalDate.now(ZoneId.of("Asia/Ho_Chi_Minh")).plusDays(plusDays);
        ZonedDateTime vnTime = targetDate.atTime(hour, minute).atZone(ZoneId.of("Asia/Ho_Chi_Minh"));
        return vnTime.toInstant();
    }

    private User seed(Role role, String name) {
        String email = role.name().toLowerCase(Locale.ROOT) + "-" + UUID.randomUUID() + "@clinic.invalid";
        User user = users.saveAndFlush(User.registerPatient(email, hash, name));
        jdbc.update("UPDATE users SET role = ? WHERE id = ?", role.name(), user.getId());
        return user;
    }

    private String token(Role role) throws Exception {
        if (!tokens.containsKey(role)) {
            User user = actors.get(role);
            String payload = mapper.writeValueAsString(Map.of("email", user.getEmail(), "password", password));
            HttpResponse<String> response = send("POST", "/api/v1/auth/login", payload, null);
            assertThat(response.statusCode()).isEqualTo(200);
            String accessToken = mapper.readTree(response.body()).path("data").path("accessToken").asText();
            tokens.put(role, accessToken);
        }
        return tokens.get(role);
    }

    private HttpResponse<String> send(String method, String path, String body, String bearer) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                    .header("Accept", "application/json");
            if (body != null) {
                builder.header("Content-Type", "application/json")
                        .method(method, HttpRequest.BodyPublishers.ofString(body));
            } else {
                builder.method(method, HttpRequest.BodyPublishers.noBody());
            }
            if (bearer != null) {
                builder.header("Authorization", "Bearer " + bearer);
            }
            return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        }
    }

    @Test
    void unauthenticatedRequestsReturn401() throws Exception {
        HttpResponse<String> resGet = send("GET", "/api/v1/appointments", null, null);
        assertThat(resGet.statusCode()).isEqualTo(401);

        HttpResponse<String> resPost = send("POST", "/api/v1/appointments", "{}", null);
        assertThat(resPost.statusCode()).isEqualTo(401);

        HttpResponse<String> resGetOne = send("GET", "/api/v1/appointments/1", null, null);
        assertThat(resGetOne.statusCode()).isEqualTo(401);
    }

    @Test
    void patientCanBookAppointmentSuccessfully() throws Exception {
        Instant slotStart = futureTime(3, 8, 30);
        String body = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "p-book-1",
                "reason", "Routine Checkup"
        ));

        HttpResponse<String> response = send("POST", "/api/v1/appointments", body, token(Role.PATIENT));
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(response.headers().firstValue("Location")).isPresent();

        JsonNode data = mapper.readTree(response.body()).path("data");
        assertThat(data.path("id").asText()).isNotBlank();
        assertThat(data.path("appointmentCode").asText()).startsWith("APP");
        assertThat(data.path("patientId").asText()).isEqualTo(mainPatient.getId().toString());
        assertThat(data.path("doctorId").asText()).isEqualTo(mainDoctor.getId().toString());
        assertThat(data.path("scheduleId").asText()).isEqualTo(mainSchedule.getId().toString());
        assertThat(data.path("startAt").asText()).isEqualTo(slotStart.toString());
        assertThat(data.path("status").asText()).isEqualTo("PENDING");
        assertThat(data.path("reason").asText()).isEqualTo("Routine Checkup");
    }

    @Test
    void receptionistCanBookForAnyPatient() throws Exception {
        Instant slotStart = futureTime(3, 9, 0);
        String body = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "rec-book-1",
                "reason", "Walk-in consultation",
                "patientId", secondPatient.getId().toString()
        ));

        HttpResponse<String> response = send("POST", "/api/v1/appointments", body, token(Role.RECEPTIONIST));
        assertThat(response.statusCode()).isEqualTo(201);

        JsonNode data = mapper.readTree(response.body()).path("data");
        assertThat(data.path("patientId").asText()).isEqualTo(secondPatient.getId().toString());
    }

    @Test
    void patientCannotSpecifyPatientId() throws Exception {
        Instant slotStart = futureTime(3, 9, 30);
        String body = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "p-book-fail-1",
                "patientId", secondPatient.getId().toString()
        ));

        HttpResponse<String> response = send("POST", "/api/v1/appointments", body, token(Role.PATIENT));
        assertThat(response.statusCode()).isEqualTo(403);
        JsonNode err = mapper.readTree(response.body());
        assertThat(err.path("code").asText()).isEqualTo("ACCESS_DENIED");
    }

    @Test
    void receptionistRequiresPatientId() throws Exception {
        Instant slotStart = futureTime(3, 9, 30);
        String body = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "rec-book-fail-1"
        ));

        HttpResponse<String> response = send("POST", "/api/v1/appointments", body, token(Role.RECEPTIONIST));
        assertThat(response.statusCode()).isEqualTo(400);
        JsonNode err = mapper.readTree(response.body());
        assertThat(err.path("code").asText()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void doctorAndAdminCannotCallPostAppointments() throws Exception {
        Instant slotStart = futureTime(3, 10, 0);
        String body = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "forbidden-book-1"
        ));

        HttpResponse<String> resDoc = send("POST", "/api/v1/appointments", body, token(Role.DOCTOR));
        assertThat(resDoc.statusCode()).isEqualTo(403);

        HttpResponse<String> resAdmin = send("POST", "/api/v1/appointments", body, token(Role.ADMIN));
        assertThat(resAdmin.statusCode()).isEqualTo(403);
    }

    @Test
    void bookingValidationFailures() throws Exception {
        // 1. Past startAt
        Instant past = Instant.now().minus(Duration.ofHours(2));
        String bodyPast = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", past.toString(),
                "requestKey", "val-past"
        ));
        HttpResponse<String> resPast = send("POST", "/api/v1/appointments", bodyPast, token(Role.PATIENT));
        assertThat(resPast.statusCode()).isEqualTo(400);

        // 2. Misaligned slot grid (schedule is at 8:00 with 30 min slots; 8:10 is invalid)
        Instant misaligned = futureTime(3, 8, 10);
        String bodyMisaligned = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", misaligned.toString(),
                "requestKey", "val-misaligned"
        ));
        HttpResponse<String> resMisaligned = send("POST", "/api/v1/appointments", bodyMisaligned, token(Role.PATIENT));
        assertThat(resMisaligned.statusCode()).isEqualTo(400);

        // 3. Out of schedule range (schedule ends at 12:00; slot at 12:00 ends at 12:30)
        Instant outRange = futureTime(3, 12, 0);
        String bodyOut = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", outRange.toString(),
                "requestKey", "val-out"
        ));
        HttpResponse<String> resOut = send("POST", "/api/v1/appointments", bodyOut, token(Role.PATIENT));
        assertThat(resOut.statusCode()).isEqualTo(400);
    }

    @Test
    void doubleBookingSlotReturns409() throws Exception {
        Instant slotStart = futureTime(3, 10, 0);
        String body1 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "dup-1"
        ));
        HttpResponse<String> res1 = send("POST", "/api/v1/appointments", body1, token(Role.PATIENT));
        assertThat(res1.statusCode()).isEqualTo(201);

        String body2 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "dup-2",
                "patientId", secondPatient.getId().toString()
        ));
        HttpResponse<String> res2 = send("POST", "/api/v1/appointments", body2, token(Role.RECEPTIONIST));
        assertThat(res2.statusCode()).isEqualTo(409);
        JsonNode err = mapper.readTree(res2.body());
        assertThat(err.path("code").asText()).isEqualTo("SLOT_ALREADY_BOOKED");
    }

    @Test
    void idempotencyReplayReturnsSameAppointmentAndConflictOnDifferentPayload() throws Exception {
        Instant slotStart = futureTime(3, 10, 30);
        String body = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "idem-test-key",
                "reason", "Initial reason"
        ));

        HttpResponse<String> res1 = send("POST", "/api/v1/appointments", body, token(Role.PATIENT));
        assertThat(res1.statusCode()).isEqualTo(201);
        String appId = mapper.readTree(res1.body()).path("data").path("id").asText();

        // Replay exactly identical requestKey and payload
        HttpResponse<String> resReplay = send("POST", "/api/v1/appointments", body, token(Role.PATIENT));
        assertThat(resReplay.statusCode()).isIn(200, 201);
        String replayedId = mapper.readTree(resReplay.body()).path("data").path("id").asText();
        assertThat(replayedId).isEqualTo(appId);

        // Same requestKey but different reason
        String bodyDiff = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "idem-test-key",
                "reason", "Different reason"
        ));
        HttpResponse<String> resConflict = send("POST", "/api/v1/appointments", bodyDiff, token(Role.PATIENT));
        assertThat(resConflict.statusCode()).isEqualTo(409);
        JsonNode err = mapper.readTree(resConflict.body());
        assertThat(err.path("code").asText()).isEqualTo("IDEMPOTENCY_CONFLICT");
    }

    @Test
    void scheduleSlotsRemovesBookedSlot() throws Exception {
        LocalDate testDate = futureTime(3, 8, 0).atZone(ZoneId.of("Asia/Ho_Chi_Minh")).toLocalDate();

        // 1. Check initial slots count
        HttpResponse<String> initialRes = send("GET", "/api/v1/doctors/" + mainDoctor.getId() + "/schedule-slots?date=" + testDate, null, token(Role.PATIENT));
        assertThat(initialRes.statusCode()).isEqualTo(200);
        JsonNode initialSlots = mapper.readTree(initialRes.body()).path("data");
        int initialCount = initialSlots.size();
        assertThat(initialCount).isGreaterThan(0);

        // 2. Book one slot
        Instant slotToBook = futureTime(3, 8, 0);
        String bookBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotToBook.toString(),
                "requestKey", "slot-removal-test"
        ));
        HttpResponse<String> bookRes = send("POST", "/api/v1/appointments", bookBody, token(Role.PATIENT));
        assertThat(bookRes.statusCode()).isEqualTo(201);

        // 3. Query slots again: slotToBook must not be in list!
        HttpResponse<String> afterRes = send("GET", "/api/v1/doctors/" + mainDoctor.getId() + "/schedule-slots?date=" + testDate, null, token(Role.PATIENT));
        assertThat(afterRes.statusCode()).isEqualTo(200);
        JsonNode afterSlots = mapper.readTree(afterRes.body()).path("data");
        assertThat(afterSlots.size()).isEqualTo(initialCount - 1);

        for (JsonNode slot : afterSlots) {
            assertThat(slot.path("startAt").asText()).isNotEqualTo(slotToBook.toString());
        }
    }

    @Test
    void patchScheduleCannotBlockOrInvalidateExistingBookings() throws Exception {
        // Book slot at 8:00
        Instant slotStart = futureTime(3, 8, 0);
        String bookBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "block-protect-test"
        ));
        HttpResponse<String> bookRes = send("POST", "/api/v1/appointments", bookBody, token(Role.PATIENT));
        assertThat(bookRes.statusCode()).isEqualTo(201);

        // Attempt to PATCH schedule to BLOCKED
        String patchBlocked = mapper.writeValueAsString(Map.of("status", "BLOCKED"));
        HttpResponse<String> blockRes = send("PATCH", "/api/v1/doctor-schedules/" + mainSchedule.getId(), patchBlocked, token(Role.ADMIN));
        assertThat(blockRes.statusCode()).isEqualTo(409);
        JsonNode errBlock = mapper.readTree(blockRes.body());
        assertThat(errBlock.path("code").asText()).isEqualTo("SCHEDULE_HAS_APPOINTMENTS");

        // Attempt to PATCH schedule start time to 8:30 (cutting off the 8:00 appointment)
        Instant newStart = futureTime(3, 8, 30);
        String patchTime = mapper.writeValueAsString(Map.of("startAt", newStart.toString()));
        HttpResponse<String> timeRes = send("PATCH", "/api/v1/doctor-schedules/" + mainSchedule.getId(), patchTime, token(Role.ADMIN));
        assertThat(timeRes.statusCode()).isEqualTo(409);
        JsonNode errTime = mapper.readTree(timeRes.body());
        assertThat(errTime.path("code").asText()).isEqualTo("SCHEDULE_HAS_APPOINTMENTS");
    }

    @Test
    void concurrentBookingsForSameSlotProduceOneSuccessAndOneConflict() throws Exception {
        Instant slotStart = futureTime(3, 11, 0);
        int threads = 2;
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch start = new CountDownLatch(1);

        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger conflictCount = new AtomicInteger(0);

        List<Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            final int index = i;
            futures.add(executor.submit(() -> {
                ready.countDown();
                try {
                    start.await();
                    String body = mapper.writeValueAsString(Map.of(
                            "scheduleId", mainSchedule.getId().toString(),
                            "startAt", slotStart.toString(),
                            "requestKey", "concurrent-race-" + index,
                            "patientId", (index == 0 ? mainPatient.getId() : secondPatient.getId()).toString()
                    ));
                    HttpResponse<String> res = send("POST", "/api/v1/appointments", body, token(Role.RECEPTIONIST));
                    if (res.statusCode() == 201) {
                        successCount.incrementAndGet();
                    } else if (res.statusCode() == 409) {
                        conflictCount.incrementAndGet();
                    }
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }));
        }

        ready.await();
        start.countDown();
        for (Future<?> f : futures) {
            f.get(10, TimeUnit.SECONDS);
        }
        executor.shutdown();

        assertThat(successCount.get()).isEqualTo(1);
        assertThat(conflictCount.get()).isEqualTo(1);
    }

    @Test
    void getAppointmentsScopedByRoleAndOwnership() throws Exception {
        // Book appointment for mainPatient with mainDoctor
        Instant slot1 = futureTime(3, 8, 0);
        String body1 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "list-test-1"
        ));
        HttpResponse<String> res1 = send("POST", "/api/v1/appointments", body1, token(Role.PATIENT));
        assertThat(res1.statusCode()).isEqualTo(201);
        String app1Id = mapper.readTree(res1.body()).path("data").path("id").asText();

        // Book appointment for secondPatient with mainDoctor (via Receptionist)
        Instant slot2 = futureTime(3, 8, 30);
        String body2 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot2.toString(),
                "requestKey", "list-test-2",
                "patientId", secondPatient.getId().toString()
        ));
        HttpResponse<String> res2 = send("POST", "/api/v1/appointments", body2, token(Role.RECEPTIONIST));
        assertThat(res2.statusCode()).isEqualTo(201);
        String app2Id = mapper.readTree(res2.body()).path("data").path("id").asText();

        // 1. ADMIN sees both
        HttpResponse<String> adminList = send("GET", "/api/v1/appointments", null, token(Role.ADMIN));
        assertThat(adminList.statusCode()).isEqualTo(200);
        JsonNode adminItems = mapper.readTree(adminList.body()).path("data").path("items");
        assertThat(adminItems.size()).isGreaterThanOrEqualTo(2);

        // 2. PATIENT only sees app1 (mainPatient)
        HttpResponse<String> patientList = send("GET", "/api/v1/appointments", null, token(Role.PATIENT));
        assertThat(patientList.statusCode()).isEqualTo(200);
        JsonNode patientItems = mapper.readTree(patientList.body()).path("data").path("items");
        assertThat(patientItems).extracting(item -> item.path("id").asText()).contains(app1Id).doesNotContain(app2Id);

        // 3. GET /appointments/{id}
        // PATIENT can view own app1
        HttpResponse<String> pGetOwn = send("GET", "/api/v1/appointments/" + app1Id, null, token(Role.PATIENT));
        assertThat(pGetOwn.statusCode()).isEqualTo(200);

        // PATIENT viewing app2 of other patient returns 404
        HttpResponse<String> pGetOther = send("GET", "/api/v1/appointments/" + app2Id, null, token(Role.PATIENT));
        assertThat(pGetOther.statusCode()).isEqualTo(404);
    }

    @Test
    void cancellingAppointmentReleasesSlotAndAllowsRebookingWithHistoryPreserved() throws Exception {
        Instant slotStart = futureTime(3, 9, 0);
        String bookBody1 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "rebook-p1",
                "reason", "Initial booking to be cancelled"
        ));

        // 1. First booking succeeds
        HttpResponse<String> res1 = send("POST", "/api/v1/appointments", bookBody1, token(Role.PATIENT));
        assertThat(res1.statusCode()).isEqualTo(201);
        String app1Id = mapper.readTree(res1.body()).path("data").path("id").asText();

        // 2. Second booking competing for the active slot is blocked
        String bookBody2 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "rebook-p2",
                "patientId", secondPatient.getId().toString()
        ));
        HttpResponse<String> resBlocked = send("POST", "/api/v1/appointments", bookBody2, token(Role.RECEPTIONIST));
        assertThat(resBlocked.statusCode()).isEqualTo(409);

        // 3. Cancel the first appointment at the data level (without D08 cancel endpoint)
        jdbc.update("UPDATE appointments SET status = 'CANCELLED' WHERE id = ?", Long.parseLong(app1Id));

        // Verify active_slot_start_utc is released to NULL
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT status, active_slot_start_utc FROM appointments WHERE id = ?", Long.parseLong(app1Id));
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("status")).isEqualTo("CANCELLED");
        assertThat(rows.get(0).get("active_slot_start_utc")).isNull();

        // 4. Now second booking for the EXACT same slot succeeds!
        HttpResponse<String> resRebooked = send("POST", "/api/v1/appointments", bookBody2, token(Role.RECEPTIONIST));
        assertThat(resRebooked.statusCode()).isEqualTo(201);
        String app2Id = mapper.readTree(resRebooked.body()).path("data").path("id").asText();
        assertThat(app2Id).isNotEqualTo(app1Id);

        // 5. Verify both records exist in DB (full historical preservation)
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND start_at_utc = (SELECT start_at_utc FROM appointments WHERE id = ?)",
                Integer.class, mainDoctor.getId(), Long.parseLong(app1Id));
        assertThat(count).isEqualTo(2);

        // 6. Verify active slot is re-blocked by the new appointment
        String bookBody3 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slotStart.toString(),
                "requestKey", "rebook-p3"
        ));
        HttpResponse<String> resBlockedAgain = send("POST", "/api/v1/appointments", bookBody3, token(Role.PATIENT));
        assertThat(resBlockedAgain.statusCode()).isEqualTo(409);
    }

    @Test
    void compositeForeignKeyEnforcesDoctorScheduleOwnership() {
        // Attempting to insert an appointment where schedule_id belongs to mainDoctor but doctor_id points to secondDoctor
        Instant slotStart = futureTime(3, 9, 30);
        Instant slotEnd = futureTime(3, 10, 0);
        String fp = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        assertThrows(DataIntegrityViolationException.class, () -> {
            jdbc.update("INSERT INTO appointments(appointment_code, patient_id, doctor_id, schedule_id, created_by, "
                    + "start_at_utc, end_at_utc, status, reason, request_key, request_fingerprint, version, created_at, updated_at) "
                    + "VALUES ('APP-MISMATCH-1', ?, ?, ?, ?, ?, ?, 'PENDING', 'Mismatch doctor and schedule', 'req-mismatch-1', ?, 0, NOW(), NOW())",
                    mainPatient.getId(), secondDoctor.getId(), mainSchedule.getId(), actors.get(Role.PATIENT).getId(),
                    slotStart, slotEnd, fp);
        });
    }

    @Test
    void concurrentBookingAndScheduleBlockingSerializeCleanly() throws Exception {
        Instant slotStart = futureTime(3, 11, 30);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);

        AtomicInteger bookStatus = new AtomicInteger(0);
        AtomicInteger patchStatus = new AtomicInteger(0);

        Future<?> patchFuture = executor.submit(() -> {
            ready.countDown();
            try {
                start.await();
                String patchBlocked = mapper.writeValueAsString(Map.of("status", "BLOCKED"));
                HttpResponse<String> res = send("PATCH", "/api/v1/doctor-schedules/" + mainSchedule.getId(), patchBlocked, token(Role.ADMIN));
                patchStatus.set(res.statusCode());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });

        Future<?> bookFuture = executor.submit(() -> {
            ready.countDown();
            try {
                start.await();
                Thread.sleep(100);
                String body = mapper.writeValueAsString(Map.of(
                        "scheduleId", mainSchedule.getId().toString(),
                        "startAt", slotStart.toString(),
                        "requestKey", "race-block-book"
                ));
                HttpResponse<String> res = send("POST", "/api/v1/appointments", body, token(Role.PATIENT));
                bookStatus.set(res.statusCode());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });

        ready.await();
        start.countDown();
        patchFuture.get(10, TimeUnit.SECONDS);
        bookFuture.get(10, TimeUnit.SECONDS);
        executor.shutdown();

        assertThat(patchStatus.get()).isEqualTo(200);
        assertThat(bookStatus.get()).isEqualTo(409);
    }

    private String tokenForUser(User user) throws Exception {
        String payload = mapper.writeValueAsString(Map.of("email", user.getEmail(), "password", password));
        HttpResponse<String> response = send("POST", "/api/v1/auth/login", payload, null);
        assertThat(response.statusCode()).isEqualTo(200);
        return mapper.readTree(response.body()).path("data").path("accessToken").asText();
    }

    @Test
    void patientAndReceptionistCanRescheduleAppointment() throws Exception {
        Instant slot1 = futureTime(3, 8, 30);
        Instant slot2 = futureTime(3, 9, 0);
        Instant slot3 = futureTime(3, 9, 30);

        // 1. Patient books slot 1
        String bookBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "resched-book-1"
        ));
        HttpResponse<String> bookRes = send("POST", "/api/v1/appointments", bookBody, token(Role.PATIENT));
        assertThat(bookRes.statusCode()).isEqualTo(201);
        String appId = mapper.readTree(bookRes.body()).path("data").path("id").asText();
        long version0 = mapper.readTree(bookRes.body()).path("data").path("version").asLong();
        assertThat(version0).isEqualTo(0L);

        // 2. Patient reschedules from slot 1 to slot 2
        String reschedBody1 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot2.toString(),
                "expectedVersion", 0
        ));
        HttpResponse<String> patchRes1 = send("PATCH", "/api/v1/appointments/" + appId + "/slot", reschedBody1, token(Role.PATIENT));
        assertThat(patchRes1.statusCode()).isEqualTo(200);
        JsonNode data1 = mapper.readTree(patchRes1.body()).path("data");
        assertThat(data1.path("id").asText()).isEqualTo(appId);
        assertThat(data1.path("startAt").asText()).isEqualTo(slot2.toString());
        assertThat(data1.path("status").asText()).isEqualTo("PENDING");
        assertThat(data1.path("version").asLong()).isEqualTo(1L);
        assertThat(data1.path("previousScheduleId").asText()).isEqualTo(mainSchedule.getId().toString());
        assertThat(data1.path("previousStartAt").asText()).isEqualTo(slot1.toString());
        assertThat(data1.path("rescheduledAt").asText()).isNotBlank();
        assertThat(data1.path("rescheduledBy").asText()).isNotBlank();

        // 3. Slot 1 is now freed: another booking on slot 1 succeeds
        String bookBodySlot1 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "resched-rebook-slot1",
                "patientId", secondPatient.getId().toString()
        ));
        HttpResponse<String> rebookRes = send("POST", "/api/v1/appointments", bookBodySlot1, token(Role.RECEPTIONIST));
        assertThat(rebookRes.statusCode()).isEqualTo(201);

        // 4. Receptionist reschedules appId from slot 2 to slot 3
        String reschedBody2 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot3.toString(),
                "expectedVersion", 1
        ));
        HttpResponse<String> patchRes2 = send("PATCH", "/api/v1/appointments/" + appId + "/slot", reschedBody2, token(Role.RECEPTIONIST));
        assertThat(patchRes2.statusCode()).isEqualTo(200);
        JsonNode data2 = mapper.readTree(patchRes2.body()).path("data");
        assertThat(data2.path("id").asText()).isEqualTo(appId);
        assertThat(data2.path("startAt").asText()).isEqualTo(slot3.toString());
        assertThat(data2.path("status").asText()).isEqualTo("PENDING");
        assertThat(data2.path("version").asLong()).isEqualTo(2L);
    }

    @Test
    void rescheduleRbacAndOwnership() throws Exception {
        Instant slot1 = futureTime(3, 8, 30);
        Instant slot2 = futureTime(3, 9, 0);

        String bookBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "resched-rbac-1"
        ));
        HttpResponse<String> bookRes = send("POST", "/api/v1/appointments", bookBody, token(Role.PATIENT));
        assertThat(bookRes.statusCode()).isEqualTo(201);
        String appId = mapper.readTree(bookRes.body()).path("data").path("id").asText();

        String reschedBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot2.toString(),
                "expectedVersion", 0
        ));

        // Unauthenticated -> 401
        HttpResponse<String> unauth = send("PATCH", "/api/v1/appointments/" + appId + "/slot", reschedBody, null);
        assertThat(unauth.statusCode()).isEqualTo(401);

        // ADMIN -> 403
        HttpResponse<String> adminRes = send("PATCH", "/api/v1/appointments/" + appId + "/slot", reschedBody, token(Role.ADMIN));
        assertThat(adminRes.statusCode()).isEqualTo(403);

        // DOCTOR -> 403
        HttpResponse<String> doctorRes = send("PATCH", "/api/v1/appointments/" + appId + "/slot", reschedBody, token(Role.DOCTOR));
        assertThat(doctorRes.statusCode()).isEqualTo(403);

        // Second patient (not owner) -> 404 (does not leak existence)
        String tokenP2 = tokenForUser(secondPatient.getUser());
        HttpResponse<String> otherPatientRes = send("PATCH", "/api/v1/appointments/" + appId + "/slot", reschedBody, tokenP2);
        assertThat(otherPatientRes.statusCode()).isEqualTo(404);
    }

    @Test
    void rescheduleValidationAndConflicts() throws Exception {
        Instant slot1 = futureTime(3, 8, 30);
        Instant slot2 = futureTime(3, 9, 0);

        // Book slot 1 for main patient
        String bookBody1 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "resched-val-1"
        ));
        HttpResponse<String> bookRes1 = send("POST", "/api/v1/appointments", bookBody1, token(Role.PATIENT));
        assertThat(bookRes1.statusCode()).isEqualTo(201);
        String app1Id = mapper.readTree(bookRes1.body()).path("data").path("id").asText();

        // Book slot 2 for second patient
        String bookBody2 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot2.toString(),
                "requestKey", "resched-val-2",
                "patientId", secondPatient.getId().toString()
        ));
        HttpResponse<String> bookRes2 = send("POST", "/api/v1/appointments", bookBody2, token(Role.RECEPTIONIST));
        assertThat(bookRes2.statusCode()).isEqualTo(201);

        // 1. Version conflict: wrong expectedVersion
        String bodyVersionConflict = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", futureTime(3, 10, 0).toString(),
                "expectedVersion", 99
        ));
        HttpResponse<String> resVer = send("PATCH", "/api/v1/appointments/" + app1Id + "/slot", bodyVersionConflict, token(Role.PATIENT));
        assertThat(resVer.statusCode()).isEqualTo(409);
        assertThat(resVer.body()).contains("VERSION_CONFLICT");

        // 2. Conflict: target slot 2 already booked
        String bodySlotBooked = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot2.toString(),
                "expectedVersion", 0
        ));
        HttpResponse<String> resSlotBooked = send("PATCH", "/api/v1/appointments/" + app1Id + "/slot", bodySlotBooked, token(Role.PATIENT));
        assertThat(resSlotBooked.statusCode()).isEqualTo(409);
        assertThat(resSlotBooked.body()).contains("SLOT_ALREADY_BOOKED");

        // Verify app1 remains unchanged on slot 1 (rollback / atomicity)
        HttpResponse<String> getApp1 = send("GET", "/api/v1/appointments/" + app1Id, null, token(Role.PATIENT));
        assertThat(getApp1.statusCode()).isEqualTo(200);
        assertThat(mapper.readTree(getApp1.body()).path("data").path("startAt").asText()).isEqualTo(slot1.toString());
        assertThat(mapper.readTree(getApp1.body()).path("data").path("version").asLong()).isEqualTo(0L);

        // 3. Validation failed: negative expectedVersion
        String bodyNegVer = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", futureTime(3, 10, 0).toString(),
                "expectedVersion", -1
        ));
        HttpResponse<String> resNegVer = send("PATCH", "/api/v1/appointments/" + app1Id + "/slot", bodyNegVer, token(Role.PATIENT));
        assertThat(resNegVer.statusCode()).isEqualTo(400);

        // 4. Validation failed: misaligned startAt
        String bodyMisaligned = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", futureTime(3, 8, 15).toString(),
                "expectedVersion", 0
        ));
        HttpResponse<String> resMisaligned = send("PATCH", "/api/v1/appointments/" + app1Id + "/slot", bodyMisaligned, token(Role.PATIENT));
        assertThat(resMisaligned.statusCode()).isEqualTo(400);

        // 5. Validation failed: startAt in past
        String bodyPast = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", Instant.now().minus(Duration.ofHours(1)).toString(),
                "expectedVersion", 0
        ));
        HttpResponse<String> resPast = send("PATCH", "/api/v1/appointments/" + app1Id + "/slot", bodyPast, token(Role.PATIENT));
        assertThat(resPast.statusCode()).isEqualTo(400);
    }

    @Test
    void patientAndReceptionistCanCancelAppointmentAndReleaseSlot() throws Exception {
        Instant slot1 = futureTime(3, 8, 30);

        // Book slot 1
        String bookBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "cancel-test-1",
                "reason", "Khám định kỳ ban đầu"
        ));
        HttpResponse<String> bookRes = send("POST", "/api/v1/appointments", bookBody, token(Role.PATIENT));
        assertThat(bookRes.statusCode()).isEqualTo(201);
        String appId = mapper.readTree(bookRes.body()).path("data").path("id").asText();

        // 1. Patient cancels appointment
        String cancelBody = mapper.writeValueAsString(Map.of(
                "reason", "Không thể đến khám đúng giờ",
                "expectedVersion", 0
        ));
        HttpResponse<String> cancelRes = send("POST", "/api/v1/appointments/" + appId + "/cancellation", cancelBody, token(Role.PATIENT));
        assertThat(cancelRes.statusCode()).isEqualTo(200);
        JsonNode cancelData = mapper.readTree(cancelRes.body()).path("data");
        assertThat(cancelData.path("id").asText()).isEqualTo(appId);
        assertThat(cancelData.path("status").asText()).isEqualTo("CANCELLED");
        assertThat(cancelData.path("reason").asText()).isEqualTo("Khám định kỳ ban đầu");
        assertThat(cancelData.path("cancellationReason").asText()).isEqualTo("Không thể đến khám đúng giờ");
        assertThat(cancelData.path("cancelledAt").asText()).isNotBlank();
        assertThat(cancelData.path("cancelledBy").asText()).isNotBlank();
        assertThat(cancelData.path("version").asLong()).isEqualTo(1L);

        // 2. Slot is released: Rebooking the same slot succeeds
        String rebookBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "cancel-rebook-2",
                "patientId", secondPatient.getId().toString()
        ));
        HttpResponse<String> rebookRes = send("POST", "/api/v1/appointments", rebookBody, token(Role.RECEPTIONIST));
        assertThat(rebookRes.statusCode()).isEqualTo(201);
        String newAppId = mapper.readTree(rebookRes.body()).path("data").path("id").asText();
        assertThat(newAppId).isNotEqualTo(appId);

        // 3. Repeated cancellation fails:
        // A. With stale version (expectedVersion = 0) -> 409 VERSION_CONFLICT
        HttpResponse<String> repeatStale = send("POST", "/api/v1/appointments/" + appId + "/cancellation", cancelBody, token(Role.PATIENT));
        assertThat(repeatStale.statusCode()).isEqualTo(409);
        assertThat(repeatStale.body()).contains("VERSION_CONFLICT");

        // B. With current version (expectedVersion = 1) -> 409 INVALID_STATE_TRANSITION (already cancelled)
        String cancelBodyCurrentVer = mapper.writeValueAsString(Map.of(
                "reason", "Hủy lại lần 2",
                "expectedVersion", 1
        ));
        HttpResponse<String> repeatCurrent = send("POST", "/api/v1/appointments/" + appId + "/cancellation", cancelBodyCurrentVer, token(Role.PATIENT));
        assertThat(repeatCurrent.statusCode()).isEqualTo(409);
        assertThat(repeatCurrent.body()).contains("INVALID_STATE_TRANSITION");
    }

    @Test
    void cancelRbacAndOwnership() throws Exception {
        Instant slot1 = futureTime(3, 8, 30);

        String bookBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "cancel-rbac-1"
        ));
        HttpResponse<String> bookRes = send("POST", "/api/v1/appointments", bookBody, token(Role.PATIENT));
        assertThat(bookRes.statusCode()).isEqualTo(201);
        String appId = mapper.readTree(bookRes.body()).path("data").path("id").asText();

        String cancelBody = mapper.writeValueAsString(Map.of(
                "reason", "Lý do hủy hợp lệ",
                "expectedVersion", 0
        ));

        // Unauthenticated -> 401
        HttpResponse<String> unauth = send("POST", "/api/v1/appointments/" + appId + "/cancellation", cancelBody, null);
        assertThat(unauth.statusCode()).isEqualTo(401);

        // ADMIN -> 403
        HttpResponse<String> adminRes = send("POST", "/api/v1/appointments/" + appId + "/cancellation", cancelBody, token(Role.ADMIN));
        assertThat(adminRes.statusCode()).isEqualTo(403);

        // DOCTOR -> 403
        HttpResponse<String> docRes = send("POST", "/api/v1/appointments/" + appId + "/cancellation", cancelBody, token(Role.DOCTOR));
        assertThat(docRes.statusCode()).isEqualTo(403);

        // Second patient -> 404
        String tokenP2 = tokenForUser(secondPatient.getUser());
        HttpResponse<String> otherPRes = send("POST", "/api/v1/appointments/" + appId + "/cancellation", cancelBody, tokenP2);
        assertThat(otherPRes.statusCode()).isEqualTo(404);
    }

    @Test
    void cancelValidationFailures() throws Exception {
        Instant slot1 = futureTime(3, 8, 30);

        String bookBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "cancel-val-1"
        ));
        HttpResponse<String> bookRes = send("POST", "/api/v1/appointments", bookBody, token(Role.PATIENT));
        assertThat(bookRes.statusCode()).isEqualTo(201);
        String appId = mapper.readTree(bookRes.body()).path("data").path("id").asText();

        // 1. Empty reason -> 400
        String emptyReason = mapper.writeValueAsString(Map.of(
                "reason", "   ",
                "expectedVersion", 0
        ));
        HttpResponse<String> resEmpty = send("POST", "/api/v1/appointments/" + appId + "/cancellation", emptyReason, token(Role.PATIENT));
        assertThat(resEmpty.statusCode()).isEqualTo(400);

        // 2. Negative expectedVersion -> 400
        String negVer = mapper.writeValueAsString(Map.of(
                "reason", "Valid reason",
                "expectedVersion", -1
        ));
        HttpResponse<String> resNeg = send("POST", "/api/v1/appointments/" + appId + "/cancellation", negVer, token(Role.PATIENT));
        assertThat(resNeg.statusCode()).isEqualTo(400);

        // 3. Reason 255 chars -> 200 OK
        String reason255 = "R".repeat(255);
        String body255 = mapper.writeValueAsString(Map.of(
                "reason", reason255,
                "expectedVersion", 0
        ));
        HttpResponse<String> res255 = send("POST", "/api/v1/appointments/" + appId + "/cancellation", body255, token(Role.PATIENT));
        assertThat(res255.statusCode()).isEqualTo(200);
        assertThat(mapper.readTree(res255.body()).path("data").path("cancellationReason").asText()).isEqualTo(reason255);

        // Book another appointment to test 256 chars
        Instant slot2 = futureTime(3, 9, 0);
        String bookBody2 = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot2.toString(),
                "requestKey", "cancel-val-2"
        ));
        HttpResponse<String> bookRes2 = send("POST", "/api/v1/appointments", bookBody2, token(Role.PATIENT));
        assertThat(bookRes2.statusCode()).isEqualTo(201);
        String app2Id = mapper.readTree(bookRes2.body()).path("data").path("id").asText();

        // 4. Reason 256 chars -> 400 VALIDATION_FAILED
        String reason256 = "R".repeat(256);
        String body256 = mapper.writeValueAsString(Map.of(
                "reason", reason256,
                "expectedVersion", 0
        ));
        HttpResponse<String> res256 = send("POST", "/api/v1/appointments/" + app2Id + "/cancellation", body256, token(Role.PATIENT));
        assertThat(res256.statusCode()).isEqualTo(400);
        assertThat(res256.body()).contains("VALIDATION_FAILED");
    }

    @Test
    void concurrentRescheduleAndBookingRace() throws Exception {
        Instant slot1 = futureTime(3, 8, 30);
        Instant slot2 = futureTime(3, 9, 0);

        // Patient 1 books slot 1
        String bookBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "race-resched-1"
        ));
        HttpResponse<String> bookRes = send("POST", "/api/v1/appointments", bookBody, token(Role.PATIENT));
        assertThat(bookRes.statusCode()).isEqualTo(201);
        String appId = mapper.readTree(bookRes.body()).path("data").path("id").asText();

        // Now two threads compete for slot 2:
        // Thread 1: Patient 1 reschedules app1 to slot 2
        // Thread 2: Receptionist books slot 2 for secondPatient
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);

        AtomicInteger rescheduleStatus = new AtomicInteger(0);
        AtomicInteger bookStatus = new AtomicInteger(0);

        Future<?> f1 = executor.submit(() -> {
            ready.countDown();
            try {
                start.await();
                String reschedBody = mapper.writeValueAsString(Map.of(
                        "scheduleId", mainSchedule.getId().toString(),
                        "startAt", slot2.toString(),
                        "expectedVersion", 0
                ));
                HttpResponse<String> res = send("PATCH", "/api/v1/appointments/" + appId + "/slot", reschedBody, token(Role.PATIENT));
                rescheduleStatus.set(res.statusCode());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });

        Future<?> f2 = executor.submit(() -> {
            ready.countDown();
            try {
                start.await();
                String bookBody2 = mapper.writeValueAsString(Map.of(
                        "scheduleId", mainSchedule.getId().toString(),
                        "startAt", slot2.toString(),
                        "requestKey", "race-competing-book",
                        "patientId", secondPatient.getId().toString()
                ));
                HttpResponse<String> res = send("POST", "/api/v1/appointments", bookBody2, token(Role.RECEPTIONIST));
                bookStatus.set(res.statusCode());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });

        ready.await();
        start.countDown();
        f1.get(10, TimeUnit.SECONDS);
        f2.get(10, TimeUnit.SECONDS);
        executor.shutdown();

        // Exactly one succeeds (200 or 201), the other gets 409 SLOT_ALREADY_BOOKED
        List<Integer> statuses = List.of(rescheduleStatus.get(), bookStatus.get());
        assertThat(statuses).contains(409);
        boolean validOutcomes = statuses.contains(200) || statuses.contains(201);
        assertThat(validOutcomes).isTrue();
    }

    @Test
    void concurrentRescheduleAndCancellationRace() throws Exception {
        Instant slot1 = futureTime(3, 8, 30);
        Instant slot2 = futureTime(3, 9, 0);

        // Patient books slot 1
        String bookBody = mapper.writeValueAsString(Map.of(
                "scheduleId", mainSchedule.getId().toString(),
                "startAt", slot1.toString(),
                "requestKey", "race-cancel-resched-1"
        ));
        HttpResponse<String> bookRes = send("POST", "/api/v1/appointments", bookBody, token(Role.PATIENT));
        assertThat(bookRes.statusCode()).isEqualTo(201);
        String appId = mapper.readTree(bookRes.body()).path("data").path("id").asText();

        // Two threads race on the same appointment with expectedVersion 0:
        // Thread 1: Reschedule to slot 2
        // Thread 2: Cancel
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);

        AtomicInteger rescheduleStatus = new AtomicInteger(0);
        AtomicInteger cancelStatus = new AtomicInteger(0);

        Future<?> f1 = executor.submit(() -> {
            ready.countDown();
            try {
                start.await();
                String reschedBody = mapper.writeValueAsString(Map.of(
                        "scheduleId", mainSchedule.getId().toString(),
                        "startAt", slot2.toString(),
                        "expectedVersion", 0
                ));
                HttpResponse<String> res = send("PATCH", "/api/v1/appointments/" + appId + "/slot", reschedBody, token(Role.PATIENT));
                rescheduleStatus.set(res.statusCode());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });

        Future<?> f2 = executor.submit(() -> {
            ready.countDown();
            try {
                start.await();
                String cancelBody = mapper.writeValueAsString(Map.of(
                        "reason", "Raced cancellation",
                        "expectedVersion", 0
                ));
                HttpResponse<String> res = send("POST", "/api/v1/appointments/" + appId + "/cancellation", cancelBody, token(Role.PATIENT));
                cancelStatus.set(res.statusCode());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });

        ready.await();
        start.countDown();
        f1.get(10, TimeUnit.SECONDS);
        f2.get(10, TimeUnit.SECONDS);
        executor.shutdown();

        // Exactly one succeeds with 200, the other fails with 409 (VERSION_CONFLICT or INVALID_STATE_TRANSITION)
        List<Integer> statuses2 = List.of(rescheduleStatus.get(), cancelStatus.get());
        assertThat(statuses2).contains(200).contains(409);
    }
}

package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;

import com.clinicmanagement.entity.*;
import com.clinicmanagement.repository.*;
import com.clinicmanagement.service.DoctorScheduleService;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ExtendWith(OutputCaptureExtension.class)
abstract class DoctorScheduleHttpTestSupport extends TestSecurityProperties {
    @LocalServerPort private int port;
    @Autowired private ObjectMapper mapper;
    @Autowired private DoctorScheduleRepository schedules;
    @Autowired private DoctorRepository doctors;
    @Autowired private SpecialtyRepository specialties;
    @Autowired private UserRepository users;
    @Autowired private PasswordEncoder passwords;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private DataSource dataSource;

    private final List<String> secrets = new ArrayList<>();
    private final Map<Role, User> actors = new EnumMap<>(Role.class);
    private final Map<Role, String> tokens = new EnumMap<>(Role.class);
    private String password;
    private String hash;

    private Specialty specialty;
    private Doctor mainDoctor;
    private Doctor secondDoctor;

    @BeforeEach
    void prepare() throws Exception {
        try (var connection = dataSource.getConnection()) {
            if (!"H2".equals(connection.getMetaData().getDatabaseProductName())) {
                MySqlTestDatabase.requireIsolatedUrl(connection.getMetaData().getURL());
            }
        }
        jdbc.execute("DELETE FROM audit_logs");
        jdbc.execute("DELETE FROM notifications");
        jdbc.execute("DELETE FROM prescription_items");
        jdbc.execute("DELETE FROM prescriptions");
        jdbc.execute("DELETE FROM medical_records");
        jdbc.execute("DELETE FROM appointments");
        jdbc.execute("DELETE FROM doctor_schedules");
        jdbc.execute("DELETE FROM patients");
        schedules.deleteAll();
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

        specialty = specialties.saveAndFlush(new Specialty("GEN", "General Medicine", "General practice", true));

        // Create doctor profiles:
        // mainDoctor linked to DOCTOR role user
        mainDoctor = doctors.saveAndFlush(new Doctor(actors.get(Role.DOCTOR), specialty, "DOC_MAIN", "LIC_MAIN", "Bio", true));

        // secondDoctor linked to another doctor user
        User secondDocUser = seed(Role.DOCTOR, "Second Doctor");
        secondDoctor = doctors.saveAndFlush(new Doctor(secondDocUser, specialty, "DOC_SEC", "LIC_SEC", "Bio 2", true));
    }

    @AfterEach
    void noCredentialOutput(CapturedOutput output) {
        for (String secret : secrets) {
            assertThat(output.getAll().contains(secret)).as("credential must not be logged").isFalse();
        }
    }

    private User seed(Role role, String name) {
        User user = users.saveAndFlush(User.registerPatient(UUID.randomUUID() + "@example.invalid", hash, name));
        jdbc.update("UPDATE users SET role = ? WHERE id = ?", role.name(), user.getId());
        return user;
    }

    protected Instant futureTime(int plusDays, int hour, int minute) {
        LocalDate targetDate = LocalDate.now(DoctorScheduleService.ZONE_VN).plusDays(plusDays);
        ZonedDateTime vnTime = targetDate.atTime(hour, minute).atZone(DoctorScheduleService.ZONE_VN);
        return vnTime.toInstant();
    }

    // ==========================================
    // ROLE PERMISSIONS & SECURITY
    // ==========================================

    @Test
    void unauthenticatedRequestsRejectedWith401() throws Exception {
        problem(call("GET", "/api/v1/doctor-schedules", null, null), 401, "AUTHENTICATION_REQUIRED");
        problem(call("POST", "/api/v1/doctor-schedules", Map.of(), null), 401, "AUTHENTICATION_REQUIRED");
        problem(call("GET", "/api/v1/doctor-schedules/1", null, null), 401, "AUTHENTICATION_REQUIRED");
        problem(call("PATCH", "/api/v1/doctor-schedules/1", Map.of(), null), 401, "AUTHENTICATION_REQUIRED");
        problem(call("GET", "/api/v1/doctors/" + mainDoctor.getId() + "/schedule-slots", null, null), 401, "AUTHENTICATION_REQUIRED");
    }

    @Test
    void postScheduleRolePermissions() throws Exception {
        Instant start = futureTime(3, 8, 0);
        Instant end = futureTime(3, 12, 0);
        Map<String, Object> payload = Map.of(
                "doctorId", mainDoctor.getId(),
                "startAt", start.toString(),
                "endAt", end.toString()
        );

        // DOCTOR: 403
        problem(call("POST", "/api/v1/doctor-schedules", payload, Role.DOCTOR), 403, "ACCESS_DENIED");
        // PATIENT: 403
        problem(call("POST", "/api/v1/doctor-schedules", payload, Role.PATIENT), 403, "ACCESS_DENIED");
        // RECEPTIONIST: 201
        var recepRes = call("POST", "/api/v1/doctor-schedules", payload, Role.RECEPTIONIST);
        assertThat(recepRes.statusCode()).isEqualTo(201);
    }

    @Test
    void patchScheduleRolePermissions() throws Exception {
        Instant start = futureTime(4, 8, 0);
        Instant end = futureTime(4, 12, 0);
        String scheduleId = createSchedule(mainDoctor.getId(), start, end, 30, ScheduleStatus.ACTIVE);

        Map<String, Object> patchPayload = Map.of("status", "BLOCKED");

        // DOCTOR: 403
        problem(call("PATCH", "/api/v1/doctor-schedules/" + scheduleId, patchPayload, Role.DOCTOR), 403, "ACCESS_DENIED");
        // PATIENT: 403
        problem(call("PATCH", "/api/v1/doctor-schedules/" + scheduleId, patchPayload, Role.PATIENT), 403, "ACCESS_DENIED");
        // ADMIN: 200
        var adminRes = call("PATCH", "/api/v1/doctor-schedules/" + scheduleId, patchPayload, Role.ADMIN);
        assertThat(adminRes.statusCode()).isEqualTo(200);
        assertThat(body(adminRes).path("data").path("status").asString()).isEqualTo("BLOCKED");
    }

    @Test
    void listSchedulesRolePermissions() throws Exception {
        // ADMIN: 200
        assertThat(call("GET", "/api/v1/doctor-schedules", null, Role.ADMIN).statusCode()).isEqualTo(200);
        // RECEPTIONIST: 200
        assertThat(call("GET", "/api/v1/doctor-schedules", null, Role.RECEPTIONIST).statusCode()).isEqualTo(200);
        // DOCTOR: 200 (for self)
        assertThat(call("GET", "/api/v1/doctor-schedules", null, Role.DOCTOR).statusCode()).isEqualTo(200);
        // PATIENT: 403
        problem(call("GET", "/api/v1/doctor-schedules", null, Role.PATIENT), 403, "ACCESS_DENIED");
    }

    @Test
    void allRolesCanAccessDoctorScheduleSlots() throws Exception {
        Instant start = futureTime(3, 8, 0);
        Instant end = futureTime(3, 10, 0);
        createSchedule(mainDoctor.getId(), start, end, 30, ScheduleStatus.ACTIVE);

        String path = "/api/v1/doctors/" + mainDoctor.getId() + "/schedule-slots";

        assertThat(call("GET", path, null, Role.ADMIN).statusCode()).isEqualTo(200);
        assertThat(call("GET", path, null, Role.RECEPTIONIST).statusCode()).isEqualTo(200);
        assertThat(call("GET", path, null, Role.DOCTOR).statusCode()).isEqualTo(200);
        assertThat(call("GET", path, null, Role.PATIENT).statusCode()).isEqualTo(200);
    }

    // ==========================================
    // CREATE & VALIDATIONS
    // ==========================================

    @Test
    void createScheduleValidationFailures() throws Exception {
        Instant validStart = futureTime(3, 8, 0);
        Instant validEnd = futureTime(3, 12, 0);

        // Past start time
        Instant pastStart = Instant.now().minus(Duration.ofHours(1));
        Instant pastEnd = Instant.now().plus(Duration.ofHours(1));
        problem(call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", mainDoctor.getId(), "startAt", pastStart.toString(), "endAt", pastEnd.toString()), Role.ADMIN),
                400, "VALIDATION_FAILED");

        // End before or equal to start
        problem(call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", mainDoctor.getId(), "startAt", validEnd.toString(), "endAt", validStart.toString()), Role.ADMIN),
                400, "VALIDATION_FAILED");

        // Crosses local midnight (22:00 day 3 to 02:00 day 4)
        Instant crossStart = futureTime(3, 22, 0);
        Instant crossEnd = futureTime(4, 2, 0);
        problem(call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", mainDoctor.getId(), "startAt", crossStart.toString(), "endAt", crossEnd.toString()), Role.ADMIN),
                400, "VALIDATION_FAILED");

        // Invalid slot minutes (45)
        problem(call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", mainDoctor.getId(), "startAt", validStart.toString(), "endAt", validEnd.toString(), "slotMinutes", 45), Role.ADMIN),
                400, "VALIDATION_FAILED");

        // Schedule duration less than slot duration
        Instant shortStart = futureTime(3, 8, 0);
        Instant shortEnd = futureTime(3, 8, 15); // 15 mins
        problem(call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", mainDoctor.getId(), "startAt", shortStart.toString(), "endAt", shortEnd.toString(), "slotMinutes", 30), Role.ADMIN),
                400, "VALIDATION_FAILED");

        // Non-existent doctor
        problem(call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", 999999, "startAt", validStart.toString(), "endAt", validEnd.toString()), Role.ADMIN),
                404, "RESOURCE_NOT_FOUND");
    }

    // ==========================================
    // OVERLAP & CONFLICTS
    // ==========================================

    @Test
    void overlappingActiveSchedulesRejectedWith409() throws Exception {
        Instant s1 = futureTime(5, 8, 0);
        Instant e1 = futureTime(5, 12, 0);
        createSchedule(mainDoctor.getId(), s1, e1, 30, ScheduleStatus.ACTIVE);

        // Attempt overlap [10:00, 14:00)
        Instant s2 = futureTime(5, 10, 0);
        Instant e2 = futureTime(5, 14, 0);
        problem(call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", mainDoctor.getId(), "startAt", s2.toString(), "endAt", e2.toString()), Role.ADMIN),
                409, "SCHEDULE_OVERLAP");

        // Attempt overlap [07:00, 09:00)
        Instant s3 = futureTime(5, 7, 0);
        Instant e3 = futureTime(5, 9, 0);
        problem(call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", mainDoctor.getId(), "startAt", s3.toString(), "endAt", e3.toString()), Role.ADMIN),
                409, "SCHEDULE_OVERLAP");

        // Attempt exact overlap [08:00, 12:00)
        problem(call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", mainDoctor.getId(), "startAt", s1.toString(), "endAt", e1.toString()), Role.ADMIN),
                409, "SCHEDULE_OVERLAP");
    }

    @Test
    void adjacentSchedulesAreAllowed() throws Exception {
        // Shift 1: [08:00, 12:00)
        Instant s1 = futureTime(5, 8, 0);
        Instant e1 = futureTime(5, 12, 0);
        createSchedule(mainDoctor.getId(), s1, e1, 30, ScheduleStatus.ACTIVE);

        // Shift 2: [12:00, 16:00) - immediately adjacent, ends_at == starts_at
        Instant s2 = futureTime(5, 12, 0);
        Instant e2 = futureTime(5, 16, 0);
        var res = call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", mainDoctor.getId(), "startAt", s2.toString(), "endAt", e2.toString()), Role.ADMIN);
        assertThat(res.statusCode()).isEqualTo(201);
    }

    @Test
    void differentDoctorsCanHaveOverlappingSchedules() throws Exception {
        Instant s1 = futureTime(5, 8, 0);
        Instant e1 = futureTime(5, 12, 0);
        createSchedule(mainDoctor.getId(), s1, e1, 30, ScheduleStatus.ACTIVE);

        // Same time for secondDoctor
        var res = call("POST", "/api/v1/doctor-schedules",
                Map.of("doctorId", secondDoctor.getId(), "startAt", s1.toString(), "endAt", e1.toString()), Role.ADMIN);
        assertThat(res.statusCode()).isEqualTo(201);
    }

    // ==========================================
    // DOCTOR SCOPE ISOLATION
    // ==========================================

    @Test
    void doctorCanOnlyViewOwnSchedules() throws Exception {
        Instant s1 = futureTime(6, 8, 0);
        Instant e1 = futureTime(6, 12, 0);
        String mainSchedId = createSchedule(mainDoctor.getId(), s1, e1, 30, ScheduleStatus.ACTIVE);

        Instant s2 = futureTime(6, 13, 0);
        Instant e2 = futureTime(6, 17, 0);
        String secondSchedId = createSchedule(secondDoctor.getId(), s2, e2, 30, ScheduleStatus.ACTIVE);

        // DOCTOR viewing own schedule: 200
        var ownRes = call("GET", "/api/v1/doctor-schedules/" + mainSchedId, null, Role.DOCTOR);
        assertThat(ownRes.statusCode()).isEqualTo(200);

        // DOCTOR viewing other doctor schedule: 404
        problem(call("GET", "/api/v1/doctor-schedules/" + secondSchedId, null, Role.DOCTOR), 404, "RESOURCE_NOT_FOUND");

        // DOCTOR listing schedules without doctorId: returns only own schedules
        var listRes = call("GET", "/api/v1/doctor-schedules", null, Role.DOCTOR);
        assertThat(listRes.statusCode()).isEqualTo(200);
        JsonNode items = body(listRes).path("data").path("items");
        for (JsonNode item : items) {
            assertThat(item.path("doctorId").asString()).isEqualTo(mainDoctor.getId().toString());
        }

        // DOCTOR querying explicitly with another doctorId: 403
        problem(call("GET", "/api/v1/doctor-schedules?doctorId=" + secondDoctor.getId(), null, Role.DOCTOR), 403, "ACCESS_DENIED");
    }

    // ==========================================
    // SCHEDULE SLOTS GENERATION
    // ==========================================

    @Test
    void scheduleSlotsGeneratedCorrectlyForActiveSchedule() throws Exception {
        // [08:00, 10:00) with 30 min slot = 4 slots
        Instant start = futureTime(7, 8, 0);
        Instant end = futureTime(7, 10, 0);
        createSchedule(mainDoctor.getId(), start, end, 30, ScheduleStatus.ACTIVE);

        LocalDate date = start.atZone(DoctorScheduleService.ZONE_VN).toLocalDate();
        var res = call("GET", "/api/v1/doctors/" + mainDoctor.getId() + "/schedule-slots?date=" + date, null, Role.PATIENT);
        assertThat(res.statusCode()).isEqualTo(200);

        JsonNode slots = body(res).path("data");
        assertThat(slots.isArray()).isTrue();
        assertThat(slots.size()).isEqualTo(4);

        assertThat(slots.get(0).path("startAt").asString()).isEqualTo(start.toString());
        assertThat(slots.get(0).path("endAt").asString()).isEqualTo(start.plus(Duration.ofMinutes(30)).toString());
        assertThat(slots.get(0).path("isAvailable").asBoolean()).isTrue();
        assertThat(slots.get(3).path("endAt").asString()).isEqualTo(end.toString());
    }

    @Test
    void blockedScheduleDoesNotGenerateSlots() throws Exception {
        Instant start = futureTime(7, 8, 0);
        Instant end = futureTime(7, 10, 0);
        createSchedule(mainDoctor.getId(), start, end, 30, ScheduleStatus.BLOCKED);

        LocalDate date = start.atZone(DoctorScheduleService.ZONE_VN).toLocalDate();
        var res = call("GET", "/api/v1/doctors/" + mainDoctor.getId() + "/schedule-slots?date=" + date, null, Role.PATIENT);
        assertThat(res.statusCode()).isEqualTo(200);

        JsonNode slots = body(res).path("data");
        assertThat(slots.size()).isEqualTo(0);
    }

    // ==========================================
    // CONCURRENCY & RACE CONDITIONS
    // ==========================================

    @Test
    void concurrentCreateOverlappingSchedulesOneWinsOneConflicts() throws Exception {
        Instant start = futureTime(8, 8, 0);
        Instant end = futureTime(8, 12, 0);
        Map<String, Object> payload = Map.of(
                "doctorId", mainDoctor.getId(),
                "startAt", start.toString(),
                "endAt", end.toString(),
                "slotMinutes", 30
        );

        var gate = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var f1 = executor.submit(() -> {
                gate.await();
                return call("POST", "/api/v1/doctor-schedules", payload, Role.ADMIN);
            });
            var f2 = executor.submit(() -> {
                gate.await();
                return call("POST", "/api/v1/doctor-schedules", payload, Role.ADMIN);
            });
            gate.countDown();
            assertThat(List.of(f1.get().statusCode(), f2.get().statusCode())).containsExactlyInAnyOrder(201, 409);
        }
    }

    // ==========================================
    // HELPERS
    // ==========================================

    private String createSchedule(Long doctorId, Instant startAt, Instant endAt, int slotMinutes, ScheduleStatus status) throws Exception {
        Map<String, Object> payload = Map.of(
                "doctorId", doctorId,
                "startAt", startAt.toString(),
                "endAt", endAt.toString(),
                "slotMinutes", slotMinutes,
                "status", status.name()
        );
        var response = call("POST", "/api/v1/doctor-schedules", payload, Role.ADMIN);
        assertThat(response.statusCode()).isEqualTo(201);
        return body(response).path("data").path("id").asString();
    }

    private JsonNode body(HttpResponse<String> response) {
        return mapper.readTree(response.body());
    }

    private void problem(HttpResponse<String> response, int status, String code) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/problem+json");
        assertThat(body(response).path("status").asInt()).isEqualTo(status);
        assertThat(body(response).path("code").asString()).isEqualTo(code);
        assertThat(response.body().contains(hash)).isFalse();
        assertThat(response.body().contains(password)).isFalse();
    }

    private String token(Role role) throws Exception {
        if (!tokens.containsKey(role)) {
            var response = request("POST", "/api/v1/auth/login",
                    Map.of("email", actors.get(role).getEmail(), "password", password), null, Map.of());
            assertThat(response.statusCode()).isEqualTo(200);
            String token = body(response).path("data").path("accessToken").asString();
            tokens.put(role, token);
            secrets.add(token);
        }
        return tokens.get(role);
    }

    private HttpResponse<String> call(String method, String path, Object payload, Role role) throws Exception {
        return request(method, path, payload, role == null ? null : token(role), Map.of());
    }

    private HttpResponse<String> request(String method, String path, Object payload, String token,
            Map<String, String> headers) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
        if (payload != null) builder.header("Content-Type", "application/json");
        if (token != null) builder.header("Authorization", "Bearer " + token);
        headers.forEach(builder::header);
        builder.method(method, payload == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)));
        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        }
    }
}

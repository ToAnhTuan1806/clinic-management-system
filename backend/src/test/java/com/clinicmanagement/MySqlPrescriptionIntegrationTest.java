package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;

import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.service.JwtTokenService;
import java.net.URI;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Tag("mysql")
@ActiveProfiles("mysql-integration")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ExtendWith(OutputCaptureExtension.class)
class MySqlPrescriptionIntegrationTest extends TestSecurityProperties {
    @LocalServerPort private int port;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private ObjectMapper mapper;
    @Autowired private UserRepository users;
    @Autowired private JwtTokenService tokens;
    @Autowired private JwtEncoder encoder;
    private String doctor;
    private String otherDoctor;
    private String patient;
    private String otherPatient;
    private String admin;
    private String receptionist;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        MySqlTestDatabase.properties(registry);
    }

    @BeforeEach
    void prepare() {
        MySqlTestDatabase.requireIsolatedUrl(System.getenv("DB_URL"));
        clean();
        PrescriptionSchemaTest.seed(jdbc);
        for (var entry : Map.of(60, "ADMIN", 61, "RECEPTIONIST").entrySet()) {
            jdbc.update("""
                    INSERT INTO users(id,email,password_hash,full_name,role,status,created_at,updated_at)
                    VALUES(?,?,'synthetic-not-login','Synthetic D12',?,'ACTIVE',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))
                    """, entry.getKey(), "d12-" + entry.getKey() + "@example.test", entry.getValue());
        }
        doctor = token(1);
        otherDoctor = token(2);
        patient = token(3);
        otherPatient = token(4);
        admin = token(60);
        receptionist = token(61);
    }

    @AfterEach
    void clean() {
        MySqlTestDatabase.requireIsolatedUrl(System.getenv("DB_URL"));
        for (String table : List.of("prescription_items", "prescriptions", "medical_records",
                "appointments", "doctor_schedules", "patients", "doctors", "specialties", "users")) {
            jdbc.update("DELETE FROM " + table);
        }
    }

    @Test
    void emptyGetUsesRealV11AndNoStore() throws Exception {
        assertThat(jdbc.queryForObject("SELECT VERSION()", String.class)).startsWith("8.4.11");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM flyway_schema_history WHERE success=1 AND CAST(version AS UNSIGNED) BETWEEN 1 AND 11", Integer.class)).isEqualTo(11);
        var empty = data(send("GET", "/prescription", doctor, null, 200));
        assertThat(empty.path("id").isNull()).isTrue();
        assertThat(empty.path("recordVersion").asLong()).isEqualTo(3);
        assertThat(empty.path("editable").asBoolean()).isTrue();
        assertThat(empty.path("simulation").asBoolean()).isTrue();
        assertThat(empty.path("items").size()).isZero();
    }

    @Test
    void replaceReorderRepeatedlyThenClearIncrementsVersionExactlyOnce() throws Exception {
        long version = 3;
        String id = null;
        for (List<String> names : List.of(List.of("A", "B", "C"), List.of("C", "A", "B"),
                List.of("B", "C", "A"), List.of("C", "B"), List.<String>of())) {
            var result = put(version, names.stream().map(this::item).toList(), 200);
            assertThat(result.path("recordVersion").asLong()).isEqualTo(++version);
            if (id == null) id = result.path("id").asText();
            assertThat(result.path("id").asText()).isEqualTo(id);
            var persisted = data(send("GET", "/prescription", doctor, null, 200));
            assertThat(persisted).isEqualTo(result);
            assertThat(persisted.path("items").size()).isEqualTo(names.size());
            for (int i = 0; i < names.size(); i++) {
                assertThat(persisted.path("items").get(i).path("medicationName").asText()).isEqualTo(names.get(i));
                assertThat(jdbc.queryForObject("SELECT sort_order FROM prescription_items WHERE id=?", Integer.class,
                        persisted.path("items").get(i).path("id").asLong())).isEqualTo(i);
            }
            assertThat(jdbc.queryForObject("SELECT version FROM medical_records WHERE id=4", Long.class)).isEqualTo(version);
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM prescriptions", Integer.class)).isOne();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM prescription_items", Integer.class)).isZero();
        var before = data(send("GET", "/prescription", doctor, null, 200));
        var stale = send("PUT", "/prescription", doctor,
                mapper.writeValueAsString(Map.of("expectedVersion", 3, "items", List.of(item("Stale")))), 409);
        assertThat(parse(stale).path("code").asText()).isEqualTo("VERSION_CONFLICT");
        assertThat(data(send("GET", "/prescription", doctor, null, 200))).isEqualTo(before);
    }

    @Test
    void maximumAndMinimumBoundariesAreAccepted() throws Exception {
        var max = new HashMap<>(item("M".repeat(200)));
        max.put("quantity", 10000);
        max.put("dosage", "D".repeat(100));
        max.put("frequency", "F".repeat(100));
        max.put("durationDays", 365);
        max.put("instructions", "I".repeat(1000));
        var result = put(3, Collections.nCopies(50, max), 200);
        assertThat(result.path("items").size()).isEqualTo(50);
        assertThat(result.path("recordVersion").asLong()).isEqualTo(4);
        assertThat(put(4, List.of(item("Min")), 200).path("items").get(0).path("quantity").asInt()).isOne();
    }

    @Test
    void invalidBoundariesAndNullItemsDoNotMutateRecord() throws Exception {
        List<Object> invalid = new ArrayList<>();
        invalid.add(Collections.nCopies(51, item("Too many")));
        invalid.add(Collections.singletonList(null));
        for (var entry : Map.of("medicationName", "M".repeat(201), "quantity", 10001,
                "dosage", "D".repeat(101), "frequency", "F".repeat(101),
                "durationDays", 366, "instructions", "I".repeat(1001)).entrySet()) {
            var bad = new HashMap<>(item("Synthetic"));
            bad.put(entry.getKey(), entry.getValue());
            invalid.add(List.of(bad));
        }
        for (String field : List.of("quantity", "durationDays")) {
            var bad = new HashMap<>(item("Synthetic"));
            bad.put(field, 0);
            invalid.add(List.of(bad));
        }
        var blank = new HashMap<>(item(" "));
        invalid.add(List.of(blank));
        for (Object items : invalid) {
            send("PUT", "/prescription", doctor, mapper.writeValueAsString(Map.of("expectedVersion", 3, "items", items)), 400);
        }
        send("PUT", "/prescription", doctor, "{\"expectedVersion\":3,\"items\":null}", 400);
        send("PUT", "/prescription", doctor, "{\"items\":[]}", 400);
        send("PUT", "/prescription", doctor, "{\"expectedVersion\":-1,\"items\":[]}", 400);
        assertUnchangedEmpty();
    }

    @Test
    void fractionalAndIncorrectJsonTypesAreRejectedWithoutCoercion() throws Exception {
        String valid = mapper.writeValueAsString(Map.of("expectedVersion", 3, "items", List.of(item("Synthetic"))));
        for (String bad : List.of(
                valid.replace("\"expectedVersion\":3", "\"expectedVersion\":3.5"),
                valid.replace("\"expectedVersion\":3", "\"expectedVersion\":\"3\""),
                valid.replace("\"quantity\":1", "\"quantity\":1.5"),
                valid.replace("\"quantity\":1", "\"quantity\":\"1\""),
                valid.replace("\"durationDays\":1", "\"durationDays\":1.5"),
                valid.replace("\"medicationName\":\"Synthetic\"", "\"medicationName\":42"),
                "{\"expectedVersion\":3,\"items\":{}}",
                "{\"expectedVersion\":3,\"items\":[42]}",
                "{\"expectedVersion\":3,\"items\":[],\"role\":\"ADMIN\"}")) {
            send("PUT", "/prescription", doctor, bad, 400);
        }
        assertUnchangedEmpty();
    }

    @Test
    void allRolesOwnershipAndMissingResourceAreEnforced() throws Exception {
        String body = mapper.writeValueAsString(Map.of("expectedVersion", 3, "items", List.of(item("Synthetic"))));
        for (String staff : List.of(admin, receptionist)) {
            send("GET", "/prescription", staff, null, 403);
            send("PUT", "/prescription", staff, body, 403);
        }
        for (String owner : List.of(patient, otherPatient)) {
            send("GET", "/prescription", owner, null, 404);
            send("PUT", "/prescription", owner, body, 403);
        }
        send("GET", "/prescription", otherDoctor, null, 404);
        send("PUT", "/prescription", otherDoctor, body, 404);
        send("GET", "/prescription", null, null, 401);
        send("PUT", "/prescription", null, body, 401);
        send("GET", "/prescription", "invalid-jwt", null, 401);
        send("PUT", "/prescription", "invalid-jwt", body, 401);
        request("GET", 999999, "/prescription", doctor, null, 404);
        assertUnchangedEmpty();
    }

    @Test
    void expiredJwtCannotReadOrWritePrescription() throws Exception {
        Instant issued = Instant.now().minusSeconds(3600);
        var claims = JwtClaimsSet.builder().issuer("clinic-management").subject("1")
                .issuedAt(issued).expiresAt(issued.plusSeconds(1800)).build();
        String expired = encoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).type("JWT").build(), claims)).getTokenValue();
        send("GET", "/prescription", expired, null, 401);
        send("PUT", "/prescription", expired, "{\"expectedVersion\":3,\"items\":[]}", 401);
        assertUnchangedEmpty();
    }

    @Test
    void unicodeIdsAndClinicalLogRedactionUseRealHttp(CapturedOutput output) throws Exception {
        String marker = "Thuốc mô phỏng 🧪 " + UUID.randomUUID();
        var first = new HashMap<String, Object>(item(marker));
        first.put("dosage", "Liều mô phỏng");
        first.put("frequency", "Lịch mô phỏng");
        first.put("instructions", "Hướng dẫn giả lập 🧪");
        var saved = put(3, List.of(first, item("Dòng giả lập thứ hai")), 200);
        assertThat(saved.path("id").isString()).isTrue();
        assertThat(saved.path("medicalRecordId").isString()).isTrue();
        assertThat(saved.path("simulation").asBoolean()).isTrue();
        for (var entry : saved.path("items")) assertThat(entry.path("id").isString()).isTrue();
        assertThat(saved.path("items").get(0).path("medicationName").asText()).isEqualTo(marker);
        assertThat(saved.path("items").get(0).path("instructions").asText()).isEqualTo(first.get("instructions"));
        assertThat(data(send("GET", "/prescription", doctor, null, 200))).isEqualTo(saved);
        assertThat(jdbc.queryForObject("SELECT medication_name FROM prescription_items WHERE sort_order=0", String.class)).isEqualTo(marker);
        for (String denied : List.of(otherDoctor, patient, otherPatient, admin, receptionist)) {
            int status = denied.equals(admin) || denied.equals(receptionist) ? 403 : 404;
            assertThat(send("GET", "/prescription", denied, null, status).body()).doesNotContain(marker);
        }
        var stale = send("PUT", "/prescription", doctor,
                mapper.writeValueAsString(Map.of("expectedVersion", 3, "items", List.of(first))), 409);
        assertThat(stale.body()).doesNotContain(marker);
        assertThat(output.getAll()).doesNotContain(marker, "Hướng dẫn giả lập 🧪",
                doctor, otherDoctor, patient, otherPatient, admin, receptionist);
    }

    @Test
    void completedRecordCannotBeChangedAndPatientMustWaitForRelease() throws Exception {
        put(3, List.of(item("Synthetic")), 200);
        send("POST", "/completion", doctor, "{\"expectedVersion\":4}", 200);
        send("GET", "/prescription", patient, null, 404);
        put(5, List.of(), 409);
        assertThat(data(send("GET", "/prescription", doctor, null, 200)).path("editable").asBoolean()).isFalse();
        send("POST", "/release", doctor, "{\"expectedVersion\":5}", 200);
        var result = data(send("GET", "/prescription", patient, null, 200));
        assertThat(result.path("recordVersion").asLong()).isEqualTo(6);
        assertThat(result.path("editable").asBoolean()).isFalse();
        assertThat(result.path("items").size()).isOne();
        send("GET", "/prescription", otherPatient, null, 404);
        put(6, List.of(), 409);
        assertThat(jdbc.queryForObject("SELECT version FROM medical_records WHERE id=4", Long.class)).isEqualTo(6);
    }

    @RepeatedTest(5)
    void concurrentPutWithSameVersionHasOneWinnerAndOneConflict() throws Exception {
        String body = mapper.writeValueAsString(Map.of("expectedVersion", 3, "items", List.of(item("Race"))));
        var responses = race(() -> send("PUT", "/prescription", doctor, body, -1),
                () -> send("PUT", "/prescription", doctor, body, -1));
        assertThat(responses.stream().map(HttpResponse::statusCode)).containsExactlyInAnyOrder(200, 409);
        assertThat(responses.stream().filter(r -> r.statusCode() == 409).map(r -> parse(r).path("code").asText()))
                .containsExactly("VERSION_CONFLICT");
        assertThat(jdbc.queryForObject("SELECT version FROM medical_records WHERE id=4", Long.class)).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM prescriptions", Integer.class)).isOne();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM prescription_items", Integer.class)).isOne();
    }

    @RepeatedTest(5)
    void putAndCompletionRaceCannotWriteAfterCompletionOrLoseVersion() throws Exception {
        String body = mapper.writeValueAsString(Map.of("expectedVersion", 3, "items", List.of(item("Race"))));
        var responses = race(() -> send("PUT", "/prescription", doctor, body, -1),
                () -> send("POST", "/completion", doctor, "{\"expectedVersion\":3}", -1));
        assertThat(responses.stream().map(HttpResponse::statusCode)).containsExactlyInAnyOrder(200, 409);
        assertThat(jdbc.queryForObject("SELECT version FROM medical_records WHERE id=4", Long.class)).isEqualTo(4);
        boolean putWon = responses.get(0).statusCode() == 200;
        assertThat(jdbc.queryForObject("SELECT status FROM appointments WHERE id=4", String.class))
                .isEqualTo(putWon ? "IN_PROGRESS" : "COMPLETED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM prescription_items", Integer.class)).isEqualTo(putWon ? 1 : 0);
        if (putWon) send("POST", "/completion", doctor, "{\"expectedVersion\":4}", 200);
        put(putWon ? 5 : 4, List.of(), 409);
    }

    @Test
    void failedReplacementRollsBackOriginalItemsPrescriptionAndRecordVersion() throws Exception {
        put(3, List.of(item("Original A"), item("Original B")), 200);
        var records = jdbc.queryForList("SELECT * FROM medical_records WHERE id=4");
        var prescriptions = jdbc.queryForList("SELECT * FROM prescriptions");
        var items = jdbc.queryForList("SELECT * FROM prescription_items ORDER BY id");
        // Scoped integrity fault: no SUPER privilege or binary-log trust changes required.
        jdbc.execute("ALTER TABLE prescription_items ADD CONSTRAINT d12_reject_item CHECK (medication_name <> 'Rejected')");
        try {
            String body = mapper.writeValueAsString(Map.of("expectedVersion", 4, "items", List.of(item("Rejected"))));
            var failed = send("PUT", "/prescription", doctor, body, 409);
            assertThat(parse(failed).path("code").asText()).isEqualTo("PRESCRIPTION_CONFLICT");
            assertThat(jdbc.queryForList("SELECT * FROM medical_records WHERE id=4")).isEqualTo(records);
            assertThat(jdbc.queryForList("SELECT * FROM prescriptions")).isEqualTo(prescriptions);
            assertThat(jdbc.queryForList("SELECT * FROM prescription_items ORDER BY id")).isEqualTo(items);
        } finally {
            jdbc.execute("ALTER TABLE prescription_items DROP CHECK d12_reject_item");
        }
        assertThat(put(4, List.of(item("Recovered")), 200).path("recordVersion").asLong()).isEqualTo(5);
    }

    private void assertUnchangedEmpty() {
        assertThat(jdbc.queryForObject("SELECT version FROM medical_records WHERE id=4", Long.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM prescriptions", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM prescription_items", Integer.class)).isZero();
    }

    private Map<String, Object> item(String name) {
        return Map.of("medicationName", name, "quantity", 1, "dosage", "1 tablet",
                "frequency", "daily", "durationDays", 1);
    }

    private String token(long id) {
        return tokens.issue(users.findById(id).orElseThrow());
    }

    private JsonNode put(long version, List<?> items, int status) throws Exception {
        return data(send("PUT", "/prescription", doctor,
                mapper.writeValueAsString(Map.of("expectedVersion", version, "items", items)), status));
    }

    private HttpResponse<String> send(String method, String suffix, String bearer, String body, int status) throws Exception {
        return request(method, 4, suffix, bearer, body, status);
    }

    private HttpResponse<String> request(String method, long id, String suffix, String bearer, String body, int status) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/medical-records/" + id + suffix));
            if (bearer != null) request.header("Authorization", "Bearer " + bearer);
            if (body != null) request.header("Content-Type", "application/json");
            request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
            var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (status >= 0) assertThat(response.statusCode()).as("%s %s status", method, suffix).isEqualTo(status);
            assertThat(response.headers().firstValue("Cache-Control").orElse("")).contains("no-store");
            return response;
        }
    }

    private JsonNode data(HttpResponse<String> response) { return parse(response).path("data"); }
    private JsonNode parse(HttpResponse<String> response) { return mapper.readTree(response.body()); }

    private List<HttpResponse<String>> race(Callable<HttpResponse<String>> first, Callable<HttpResponse<String>> second) throws Exception {
        var barrier = new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var a = pool.submit(() -> { barrier.await(10, TimeUnit.SECONDS); return first.call(); });
            var b = pool.submit(() -> { barrier.await(10, TimeUnit.SECONDS); return second.call(); });
            return List.of(a.get(30, TimeUnit.SECONDS), b.get(30, TimeUnit.SECONDS));
        }
    }
}

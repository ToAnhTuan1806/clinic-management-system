# D11 — Medical history and release policy

Policy confirmed by the task owner in Codex on 2026-11-22. Backend implementation
and final D11 DTO/authorization contract remain pending. The available checkout is
D10 at baseline `587668e`; FR-10 is still PROPOSED in `docs/API_CONTRACT.md`.
No separate SRS file was found; `docs/requirements/FEATURE_SCOPE.md` supplies FR-09/FR-10.

## Approved transition

- Legacy D10 records that have completion metadata and an appointment in COMPLETED
  retain patient visibility: V10 copies completed_at → released_at and completed_by
  → released_by. This is historical attribution, not evidence of a separate release
  action performed by that actor. Original clinical data, timestamps, version, IDs,
  appointment rows and Flyway history V1–V9 remain unchanged.
- Drafts, missing completion metadata and records whose appointment is not COMPLETED
  are not backfilled. Existing inconsistencies are quarantined from patient visibility;
  this migration neither repairs nor republishes them silently.
- New D11 completions have NULL release fields. Release is a separate operation by
  the doctor assigned to the appointment. Patient reads require both COMPLETED and
  released_at, with patient.user_id equal to the authenticated user. No email/phone
  linking or inference is permitted; unlinked walk-in patients have no account access.

## Storage and service boundaries

V10 adds nullable DATETIME(6) released_at, nullable signed BIGINT released_by and a
RESTRICT/RESTRICT FK to users. A CHECK requires both release fields NULL, or both
non-NULL with completed_at/completed_by present and released_at >= completed_at.
A single explicit released_by index supports the FK. No history-query index is
added without a measured query need. Times are UTC, set by the server-side Clock;
DATETIME itself cannot encode or validate a timezone. API timestamps must use UTC ISO-8601.

MySQL CHECK cannot reference appointments or enforce a user's current role/assignment.
Backend must lock/reload the appointment and record, verify ACTIVE authenticated
DOCTOR assignment and COMPLETED status, check expectedVersion and write release
metadata plus increment version in one transaction. Never trust released_by or
patient/doctor IDs supplied by a client. Release must not edit clinical content.
The exact release endpoint, DTO and duplicate-release response are not yet agreed;
no public test endpoint is proposed here. Duplicate release must preserve the first
actor/time and must not create extra version increments; BE must choose idempotent
success or an explicit conflict and document it. Concurrent attempts must not overwrite.

ADMIN/RECEPTIONIST receive an explicit metadata projection, with no symptoms,
diagnosis, notes, conclusion or clinical markers in responses, logs or error details.
Doctor access to another provider's historical notes requires an explicit Backend
rule for an assigned patient; default to denying cross-provider clinical access until
that rule is implemented and tested. Metadata still requires object-level scoping.
Patient list, detail and lookup routes must share the same released/self policy.
Do not enforce the rule only in the new history list while leaving D10 detail open.
Responses should use no-store; unauthorized IDs should not reveal clinical existence.

## Deployment and migration recovery

Run Flyway once on a backed-up maintenance copy first. Quiesce record completion
and release writes during upgrade, then deploy the D11 service enforcing release gates
before opening patient traffic. A V10 schema by itself does not secure D10 endpoints:
the existing D10 service checks completion but has no release predicate.
Do not deploy V10 and assume D11 privacy has been implemented.

Versioned SQL is applied once by Flyway; a second migrate must be a no-op. Do not rerun
raw ALTER/UPDATE SQL after success. MySQL DDL has implicit commits; failure is not an
atomic application rollback. Retain backup/evidence and diagnose partial DDL before
an explicitly reviewed forward fix. No clean, repair, baseline, shared database or
volume deletion is part of this task. A rollback to D10 code would expose all newly
completed records again; keep patient traffic closed until the compatible D11 service
is restored. Do not remove release metadata to roll back.

## Query and API QA handoff

History identity comes from appointments; no patient_id/doctor_id copies are added
to medical_records. Candidate visit-time ordering is start_at_utc DESC, appointment.id
DESC, with bounded page size and a matching cursor; the final API sort contract needs
BE confirmation. Existing patient/start/id and doctor/time/status indexes plus UNIQUE
medical_records.appointment_id are measured with synthetic data. Completion-time
ordering is a different query shape and requires a new plan review if BE chooses it.
SQL predicates/projections demonstrate storage/query behavior, not HTTP authorization.

The following 12 API scenarios are prepared and **PENDING / NOT EXECUTED** until BE
D11 lands. They must not be reported as passing on the D10 service:

| ID | Scenario | Required check |
| --- | --- | --- |
| H01 | Patient own released COMPLETED history | Correct patient, clinical data permitted |
| H02 | Patient own newly completed, unreleased record | Absent from history and denied by detail/lookup |
| H03 | Patient own draft | No clinical visibility |
| H04 | Patient changes patientId/recordId to another patient | Denied without data/existence leak |
| H05 | Assigned doctor history | Scope matches approved cross-provider rule |
| H06 | Unassigned doctor history/release | Denied |
| H07 | ADMIN history/detail/lookup | Metadata only, including errors/logs |
| H08 | RECEPTIONIST history/detail/lookup | Metadata only, including errors/logs |
| H09 | Missing/invalid JWT | 401, no data |
| H10 | Wrong role tries release | 403, no row/version change |
| H11 | Release before completion, stale version and concurrent release | Rejected/serialized; first actor/time preserved |
| H12 | Repeated/paginated GET history | Stable time/ID ordering, no missing/duplicate rows, no writes |

Use multiple synthetic patients and doctors and both old-backfilled and new-unreleased
records. Credentials/JWT stay outside Git/evidence. The SQL migration fixtures are
non-login accounts; API fixtures must use generated BCrypt credentials when BE is ready.

## Measured index evidence

`docs/qa/evidence/CL-D11-INDEX.json` records both V9 and V10 EXPLAIN ANALYZE/JSON
plans on MySQL 8.4.11 with 300 synthetic patients, 12 doctors and 12,000 completed
visits. V10 backfilled all 12,000 records. No shared data or host port was used.

| V10 candidate query | Actual plan observation | Single-sample total time |
| --- | --- | ---: |
| Patient history, LIMIT 20 | patient/start/id reverse lookup; 20 appointment rows and 20 unique record probes | 0.210 ms |
| Doctor history, LIMIT 20 | existing doctor/time/status covering lookup scans 1,000 doctor rows and sorts; 20 record probes | 0.329 ms |
| Patient + doctor + time range | patient/time range scans 35 rows, returns 3; unique record lookup | 0.115 ms |

These are local warm EXPLAIN samples, not an SLA or a production load test. The doctor
query's sort remains a scaling concern. Re-evaluate its index against the final BE
ordering/cursor and realistic skew before adding a doctor/start/id index. An index on
released_at alone is not justified by these patient/doctor-scoped plans. No new query
index was added; the explicit released_by index serves the new FK only. Scripts stop
their own QA container and retain the volume. Clinical payloads are not selected by
these query-plan probes.

## Validation and review handoff

Database scope: **READY FOR REVIEW**. D11 HTTP security scope: **PENDING BACKEND**.
The task owner approved this policy; the Backend team still needs to implement and
review the DTO, release transaction, shared patient read gates and history query.

Final execution on new MySQL 8.4.11 schemas:

- H2/unit regression: 281 PASS / 0 FAIL / 0 SKIPPED.
- MySQL regression: 197 PASS / 0 FAIL / 0 SKIPPED, including D07–D10 HTTP/security
  tests and the two new D11 migration/constraint test groups.
- Total executed JUnit cases: 478 PASS / 0 FAIL / 0 SKIPPED.
- D11 API cases H01–H12: 0 executed, 12 SKIPPED/PENDING; no D11 HTTP PASS claim.
- Fresh V1–V10 and seeded V9→V10 upgrade PASS; Flyway validate, checksum comparison
  and repeat no-op PASS. Old record columns and appointment rows are unchanged;
  legacy visible record IDs are unchanged; only nine eligible records out of the
  12 mixed-state upgrade fixtures receive historical release metadata.
- FK rejects an unknown actor and prevents deletion/update of an actor referenced
  only by released_by. CHECK rejects half metadata, publication before completion,
  reversed timestamps and removal of completion metadata after release.
- New completions remain unreleased; microsecond timestamp precision is verified.
- Hibernate ddl-auto=validate startup PASS for existing D10 mappings on V10.
  This does not validate future released_at/released_by Entity mappings, which are
  not in the available Backend yet. H2 release mapping/fixture parity must accompany
  that Backend change; existing D10 H2 regression remains green.
- The initial V10 draft had an ALTER index syntax error in isolated QA. It was fixed
  before its first successful application; the final run used new databases without
  clean/repair/baseline or editing any previously successful migration.

V10 SHA-256: `c2d3b6ab3688701fa8454849a5b89b4ac360f7fbe1ffe5bd47c2e06fb478893b`.
Flyway checksum: `-1009264399` (same fresh/upgrade). V1–V9 match both HEAD and the
pre-D11 baseline. All owned test containers are stopped and volumes retained.
Detailed evidence: [database](../qa/evidence/CL-D11-DB.json),
[index plans](../qa/evidence/CL-D11-INDEX.json).

Re-run from this workspace with Java 21, Python, Docker Linux and cached mysql:8.4:

```powershell
python database/qa/validate_d11.py
python database/qa/benchmark_d11_history.py
```

The runners generate credentials in memory, only use new isolated containers/schemas,
never read .env and never print credentials. They leave the old shared Clinic and
SmartExpense services untouched. The benchmark uses no host port or external network.
Do not commit .qa-runtime, build outputs, credentials or full runtime logs.

D11-only files to review (eight files; no Git staging/commit performed):

- backend/src/main/resources/db/migration/V10__add_medical_record_release.sql
- backend/src/test/java/com/clinicmanagement/MedicalHistorySchemaTest.java
- backend/src/test/java/com/clinicmanagement/MedicalRecordSchemaTest.java
- database/qa/validate_d11.py
- database/qa/benchmark_d11_history.py
- docs/database/MEDICAL_HISTORY_RELEASE_POLICY.md
- docs/qa/evidence/CL-D11-DB.json
- docs/qa/evidence/CL-D11-INDEX.json

The existing uncommitted D02 changes were preserved and are outside this handoff.

Post-run persistence/recovery check: the first Docker stop of the regression container
hit its default timeout (exit 137, OOMKilled=false). The owned container was restarted;
InnoDB CHECK TABLE on appointments and medical_records returned OK, the upgrade schema
still had all 12 records with the expected 9 released legacy records and the same V10
Flyway checksum. A subsequent stop with timeout 60 exited cleanly with code 0. Both
D11 runners now allow that shutdown grace period. No container/database/volume was deleted.

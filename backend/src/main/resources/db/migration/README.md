# Flyway migration boundary — D02

D02 introduces exactly `V1__create_users.sql` for review, based on the CL-D02-DB task.
It creates only users: single role, four role values, ACTIVE/DISABLED, canonical
email UNIQUE and UTC timestamps supplied by BE. No seed account or profile tables.
Never add V001 alongside V1: both identify version 1. Future migrations use V2, V3, etc.
The migration has been tested only on a newly provisioned isolated QA instance;
review is still required before migrating the shared Clinic database.
Flyway creates its own schema-history table on a configured database.
`ddl-auto=validate` prevents Hibernate from creating tables;
`baseline-on-migrate=false` and `clean-disabled=true` prevent implicit baselining
and Flyway clean. Never edit a versioned migration after it has been applied.

For D01 verification before schema approval, activate `mysql-validation`. It keeps
Flyway enabled but replaces the startup migration strategy with `Flyway.validate`,
so verification does not create schema history or apply SQL. The MySQL test uses
this profile as well. Once V1 exists, validation on a database without V1 will report
a pending migration; use the dedicated isolated D02 validation flow instead of
treating that as approval to migrate the shared database.
The default profile still calls migrate; running it against a shared database requires
review first. Never edit the applied V1; add a new version for subsequent changes.

Evidence and BE handoff: `docs/qa/TEST_PLAN.md`, `docs/database/DATABASE_DESIGN.md`.
Reproducible checks: `database/qa/validate_d02.py` and `D02DatabaseValidation.java`.

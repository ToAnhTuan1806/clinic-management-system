# Flyway migration boundary

D01 prepares Flyway but introduces no domain tables. This directory intentionally
contains no versioned SQL yet. Agree the ERD and ownership with the DB team before
adding `V1__initial_schema.sql`. Flyway creates its own schema-history table on a
configured database. `ddl-auto=validate` prevents Hibernate from creating tables;
`baseline-on-migrate=false` and `clean-disabled=true` prevent implicit baselining
and Flyway clean. Never edit a versioned migration after it has been applied.

For D01 verification before schema approval, activate `mysql-validation`. It keeps
Flyway enabled but replaces the startup migration strategy with `Flyway.validate`,
so verification does not create schema history or apply SQL. The MySQL test uses
this profile as well. The default profile still calls migrate; running it requires
agreement on schema-history creation and any migrations first.

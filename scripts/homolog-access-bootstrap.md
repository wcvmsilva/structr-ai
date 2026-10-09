# Homolog identity bootstrap

Administrative provisioning for the isolated `structr-ai-homolog` reference
`wmspwegbqtzamkhxhusg`. This tool has no application route, connection factory,
environment-file loader, Auth API, HTTP client or `apply` command.

It creates exactly two synthetic tenants and three active profiles with role
`user`. A1 and A2 belong to A; B1 belongs to B. It does not create memberships,
clients, projects, drafts, geographic evidence, catalog, permissions, Auth rows
or issuer configuration. Memberships require a separately formed project. The
ADR-002 runtime continues to refuse approval, revocation, versioning and export.

## References are not attestations

- `providerSubject` is a real provider UID supplied and independently confirmed
  by the operator. The offline validator checks its format and uniqueness only;
  it does not establish that an Auth user or session exists. The test UIDs below
  are synthetic and must never be represented as real provider identities.
- `sourceCommit` is a supplied source reference. It does not prove which source
  is deployed or which checkout is executing.
- `projectRef` is an exact manifest allowlist. It cannot authenticate an injected
  database handle or connector destination. The supervisor must independently
  verify the environment before execution. Results deliberately retain
  `authVerified:false` and `databaseTargetVerified:false`.
- Real JWT verification, provider TTL at most 900 seconds, issuer activation,
  hosted sessions and the later product journey are separate gates.

## Manifest

The Zod object is strict at every level. There must be two tenant keys A/B and
three profile keys A1/A2/B1. UUIDs are canonical lowercase and nonzero. Operation,
tenant, internal profile and provider subject identifiers must all differ.
Tenant slugs must be distinct, begin `homolog-access-` and contain lowercase
ASCII letters, digits and hyphens. There are no credentials, email addresses,
arbitrary roles, display names, settings or SQL fields in the manifest.

Illustrative synthetic input, not provider evidence or an executed bootstrap:

```json
{
  "version": "structr-homolog-identities-v1",
  "projectRef": "wmspwegbqtzamkhxhusg",
  "operationId": "10000000-0000-4000-8000-000000000001",
  "sourceCommit": "f08a7f0f028d11fe4433beb4340ba57e851a6a7d",
  "tenants": {
    "A": {
      "id": "20000000-0000-4000-8000-000000000001",
      "slug": "homolog-access-example-a"
    },
    "B": {
      "id": "20000000-0000-4000-8000-000000000002",
      "slug": "homolog-access-example-b"
    }
  },
  "profiles": {
    "A1": {
      "id": "30000000-0000-4000-8000-000000000001",
      "providerSubject": "40000000-0000-4000-8000-000000000001",
      "tenant": "A",
      "role": "user"
    },
    "A2": {
      "id": "30000000-0000-4000-8000-000000000002",
      "providerSubject": "40000000-0000-4000-8000-000000000002",
      "tenant": "A",
      "role": "user"
    },
    "B1": {
      "id": "30000000-0000-4000-8000-000000000003",
      "providerSubject": "40000000-0000-4000-8000-000000000003",
      "tenant": "B",
      "role": "user"
    }
  }
}
```

Generate new internal identifiers once, then retain the exact approved manifest
for recovery. Never reuse these illustrative identifiers in a hosted operation.

## Offline CLI

```sh
pnpm exec tsx scripts/homolog-access-bootstrap.ts validate /private/path/manifest.json
pnpm exec tsx scripts/homolog-access-bootstrap.ts plan /private/path/manifest.json
```

Both commands read one regular nonsymlink file, at most 64 KiB, and emit only
status, operation ID, canonical manifest SHA-256, counts and the two explicit
unverified flags. They never connect or write a file. Bad arguments, malformed
input and file errors exit 2 with a fixed error code; the CLI does not echo input
values, paths or driver details. Object key order does not change the hash.

The separately authorized SQL renderer is also offline:

```sh
umask 077
pnpm exec tsx scripts/homolog-access-bootstrap.ts sql /private/path/manifest.json > /private/path/review.sql
```

Unlike the summary, this private SQL artifact necessarily contains the intended
internal IDs and provider subject references. It contains no credentials. Review
the exact artifact before sending it anywhere; do not publish it as a public log.
The CLI still does not execute SQL. `apply` is refused.

## Two distinct administrative executors

### Injected Drizzle transaction

`bootstrapHomologAccess(db, manifest)` accepts an independently verified
administrative Drizzle handle. It uses `db.transaction` at SERIALIZABLE isolation
and **awaits the real `logAudit(..., tx)`** on the same handle for each row and the
completion receipt. The existing audit module now imports `getDb` lazily only
for callers that did not supply a transaction, or for its existing read helpers.
An injected transaction therefore does not import web startup configuration or
create a second connection.

The helper retries the complete transaction at most three times for SQLSTATE
40001/40P01 only. Other SQL/driver errors become `HOMOLOG_BOOTSTRAP_FAILED`; no
database error values or connection information are returned.

### Connector SQL transaction

`renderHomologAccessSql(manifest)` returns a reviewed SQL artifact for a separate
administrative connector. It shares Zod validation, canonical manifest hashing,
the exact desired row plan and Drizzle column metadata with the TypeScript
executor. Its transaction/receipt enforcement is SQL and is separately tested.

The artifact contains `BEGIN ISOLATION LEVEL SERIALIZABLE`, one anonymous DO
block, a sanitized summary and `COMMIT`. The block verifies the effective
isolation and read/write transaction state. It sets a local `pg_catalog` search
path, acquires the same transaction advisory lock, performs explicit audit
inserts and checks all readback and audit evidence before returning. It creates
no table, function, role, grant or RPC. Its local custom settings contain only
execution metadata/status, never JWT claims or authority.

**This path does not execute TypeScript `db.transaction()` or `logAudit()`.** It
is a reviewed offline administrative artifact; no hosted execution has occurred.
The physical tests establish transactional and durable audit guarantees through
SQL, not literal invocation of AGENTS F2/F5 helpers. Remote use remains contingent
on review of the exact artifact and explicit ratification of this administrative
execution contract. It is not a replacement business mutation path; do not
silently generalize this distinction to application mutations.

The caller must send the complete reviewed batch to one transaction-capable
administrative connection in the verified homolog environment. On failure, the
connector must roll back its transaction before reuse. Never send the individual
inserts or audit statements as separate requests. A preexisting weaker
transaction is refused by the isolation check rather than assumed serializable.

SQLSTATE 40001/40P01 is preserved with the sanitized message
`HOMOLOG_BOOTSTRAP_RETRY_REQUIRED`. The caller may roll back and repeat the exact
whole batch, at most three attempts. Arbitrary failures are not automatically
retried. No retry executes just the failed statement.

The SQL completion receipt additionally records
`executorId=structr-homolog-identities-sql-v1` and `executorHash`. That SHA-256
covers the returned `body` string (local search path, DO block and summary),
before the hash is inserted into its enclosing BEGIN/metadata/COMMIT envelope.
It is not self-referential. Hash the complete artifact separately when retaining
the transport evidence. These hashes identify reviewed text; they are not
signatures or proof of the actual remote destination. A receipt created through
Drizzle retains its recorded shape when subsequently replayed through SQL, and
vice versa: replay does not rewrite history.

Both executors validate SQL metadata against the exact ID and body hash produced
by the current reviewed renderer for the approved manifest. A well-formed hash
from another manifest or an older artifact is not accepted merely because it is
64 hexadecimal characters. The TypeScript verifier renders that expectation
independently of persisted evidence. The SQL block captures the generated
envelope's expected hash into a local variable before any INSERT or trigger; it
uses that variable for receipt verification and restores it for the final
summary. A trigger changing the hash setting cannot change that expectation.

On creation, SQL requires its exact metadata pair and Drizzle requires both
fields to be absent. On replay, both absent remains the intentional supported
Drizzle shape; if either property is present, both must contain the exact SQL
ID/hash. Null, incomplete, unknown or different values refuse the operation.
Absence is **not proof of origin**: without external evidence, removal of both
fields from an old SQL receipt is indistinguishable from the permitted Drizzle
shape. This verifier does not invent an origin attestation. No SQL executor was
applied remotely before this correction; previously generated artifacts must be
regenerated and reviewed, rather than trusting their receipt hashes as an
automatic allowlist.

## Shared transaction guarantees

1. Acquire a transaction advisory lock scoped to the operation ID.
2. Find the completion receipt and all audit evidence carrying that operation.
   A replay requires one receipt, five exact row audits, the same canonical
   manifest/hash and the entire current row state. Duplicate, incomplete or
   contradictory evidence refuses the operation.
3. For a new operation, refuse collisions against tenant IDs/slugs, profile IDs
   and external subject mappings, including identifiers reused across these
   namespaces. There is no upsert, rebind, implicit tenant selection or repair.
4. Insert two demo tenants with explicit Charleston region and
   `America/New_York` timezone; insert three active `user` profiles. Email,
   company, login method and last-sign-in remain null rather than invented.
5. Audit each insertion with `before=null` established by the preflight and the
   exact expected new row. Read back all modeled columns and compare them.
6. Insert the completion receipt, then read back and verify the rows **and all
   six audit records**. A changed/suppressed audit or business row rolls back
   every preceding insertion. Timestamps retain PostgreSQL microsecond precision
   in the administrative snapshots, so a one-microsecond change is drift.

The receipt is stored in the existing `audit_logs` table, with logical table name
`homolog_identity_bootstrap` and `record_id=operationId`. Its payload includes
version, operation ID, manifest hash, supplied manifest and exact tenant/profile
snapshots. All six `audit_logs.user_id` values are null: A1 is a newly provisioned
beneficiary, not an authenticated author of this administrative operation. The
receipt's `administrativeActor` records `kind=database-principal` and the actual
`current_user`/`session_user` observed inside the transaction. It makes no claim
about a human identity, JWT or Auth session. Replay validates this historical
provenance without changing it to the principal performing the replay.

Replay produces no additional audit rows. Existing mutations or manual changes
are not undone by replay: drift is reported and must be reviewed separately.
After an unknown connector outcome, rerun only the same reviewed artifact and
manifest; never generate replacement IDs to conceal a possibly committed run.

## Withdrawal and subsequent gates

No withdrawal mutation is implemented by this tool. A separately reviewed,
audited administrative transaction can deactivate these exact profiles/tenants,
retaining their mappings and evidence. Issuer activation and deactivation are
also separate reviewed operations. A successful identity bootstrap does not
enable the empty ADR-002 issuer configuration and does not prove a session.

Actual issuer/TTL/JWT and hosted HTTP proofs precede access opening. Any later
membership grant must check the product-created project and tenant. In
particular, withdrawing membership does not revoke a project owner's independent
authority; use a non-owner for that test. No precreated project/draft from this
tool can be counted as a product journey.

## Focused physical verification

The opt-in test uses the existing owned socket-only PostgreSQL 17 harness and
versioned migrations 0000–0014. It does not install or claim to test boundary
migration 0015. Auth schema absence is asserted: no synthetic Auth rows, signer,
provider HTTP request or cloud connection is needed for this provisioning proof.

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C LC_ALL=C NODE_ENV=test \
  APP_PRINCIPAL_LAB=1 HOMOLOG_BOOTSTRAP_PHYSICAL=1 \
  pnpm exec vitest run server/homolog-access-bootstrap.test.ts \
  --maxWorkers=1 --minWorkers=1 --no-file-parallelism
```

Without both opt-in flags the physical groups are explicitly skipped. The same
creation/replay/collision/drift/audit-failure scenarios run against both
executors, plus cross-executor replay and simultaneous competing database
connections. Real lab triggers produce late audit failure and changed readback;
the product schema is not changed. Each cluster is stopped and its owned
directory removal is verified after the run. No full-suite, application build,
remote application or production acceptance is implied by these focused tests.


## Separate administrative runner

`scripts/homolog-access-runner.ts` adds explicit `preflight` and `apply` commands.
The original bootstrap CLI remains offline. The runner uses the existing
`bootstrapHomologAccess(drizzle(client), manifest)` implementation, including its
literal Drizzle transaction and six awaited transactional `logAudit` calls. It
does not execute the SQL renderer as an administrative mutation or rely on IF-1.
No router, web startup, environment-file loader, Auth client or ambient
`DATABASE_URL` is involved.

Supply two explicit paths: the approved manifest and a protected connection JSON
file. The connection file must be owned by the current user, have no group or
other permissions (for example 0600), be a regular nonsymlink file and be at most
32 KiB. The manifest remains bounded to 64 KiB and must also be a regular
nonsymlink file. Both reads are bounded even if the file grows while being read;
nonregular inputs, including FIFOs, are refused.

The connection JSON has exactly these required properties:

```json
{
  "version": "structr-homolog-admin-connection-v1",
  "projectRef": "wmspwegbqtzamkhxhusg",
  "host": "db.wmspwegbqtzamkhxhusg.supabase.co",
  "port": 5432,
  "database": "postgres",
  "user": "postgres",
  "password": "REPLACE_IN_THE_PROTECTED_FILE_ONLY"
}
```

An optional `caCertificate` property may contain one valid PEM public certificate,
up to 16 KiB. Private keys, extra payloads and arbitrary connection/TLS options
are rejected. With or without the supplied CA, TLS certificate-chain validation
and hostname validation remain mandatory. Only the independently confirmed direct
host above is supported. No pooler, IP address, socket, alternative database,
URL override or destination fallback is accepted. Passwords never belong in
command arguments, this repository, receipts or console output.

Before loading the privileged bootstrap dependency graph, both commands require
`manifest.sourceCommit` to equal the executing checkout's exact HEAD and require
its relevant source to be tracked and clean. The check covers this runner, the
bootstrap, its SQL renderer used for receipt verification, transactional audit,
schema, taxonomy, package manifest, dependency lock and TypeScript resolution
configuration. Actual file hashes must match their committed blobs even when
Git index flags hide changes. Untracked or ignored sibling files that could
shadow the relevant imports are refused. It does not attest the installed dependency bytes, the deployed web
release, Auth identities or a remote database. Use the same reviewed commit and
exact manifest for replay; changing a manifest source reference changes its hash.

```sh
pnpm exec tsx scripts/homolog-access-runner.ts preflight /private/path/manifest.json /private/path/connection.json
pnpm exec tsx scripts/homolog-access-runner.ts apply /private/path/manifest.json /private/path/connection.json
```

`preflight` performs no database connection. Its summary explicitly retains
`databaseTargetVerified:false` and `authVerified:false`. After successful apply,
the runner reports `databaseTargetVerified:true` with
`targetVerification:direct-host-verified-tls`: this records the direct hostname
and TLS policy used by this administrative connection, supplemented by database
and read/write checks. It is not proof of provider accounts, JWTs, sessions,
issuer activation or the deployed product journey. Auth remains unverified.
The helper's durable bootstrap receipt remains unchanged; the wrapper summary
is separate evidence and contains no credentials, provider subjects or row
snapshots. The runner never creates an additional receipt or rewrites history.

The connection is limited to one client and closed on success or failure. There
is no runner-level automatic retry. The helper retains only its existing whole
transaction retry for SQLSTATE 40001/40P01. Failures print only a fixed code and
exit 2, with no path, Git output, SQL, password or driver diagnostic. A failure,
including `HOMOLOG_CONNECTION_CLOSE_FAILED`, does not by itself prove rollback:
a transport failure can leave the outcome unknown. Resolve that condition by
reviewing the durable evidence and replaying only the same approved manifest
from the same reviewed source, never by inventing replacement identities.

Focused verification:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C LC_ALL=C NODE_ENV=test \
  pnpm exec vitest run server/homolog-access-runner.test.ts \
  --maxWorkers=1 --minWorkers=1 --no-file-parallelism

env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C LC_ALL=C NODE_ENV=test \
  APP_PRINCIPAL_LAB=1 HOMOLOG_BOOTSTRAP_PHYSICAL=1 \
  pnpm exec vitest run server/homolog-access-runner-physical.test.ts \
  --maxWorkers=1 --minWorkers=1 --no-file-parallelism
```

The physical runner tests replace only the external postgres client factory with
the existing owned socket-only laboratory connection. Drizzle, the bootstrap,
transactional audit writes, actual durable rows, failures, replay and client
shutdown remain real. They additionally exercise the configured TLS hostname
checks, but do not establish a hosted TLS handshake or hosted database success.
No production flag or alternative destination bypass exists for these tests.

# Administrative read-proof fixture

This bounded tool prepares the synthetic 0017 access proof in `structr-ai-homolog`
(`wmspwegbqtzamkhxhusg`). It is not formation through the product and cannot prove
financial calculation, approval, versioning, export, provider authentication or
operational readiness. Production is outside its manifest allowlist.

## Prerequisites and manifest

Provision real A1/A2/B1 provider identities through the supported Auth workflow,
then use the existing identity bootstrap to create exactly two synthetic tenants
and three active `user` profiles. Keep the human operator O separate. This tool
does not call Auth, create profiles/tenants or change the issuer. It validates
the existing bootstrap's complete receipt, five row audits and exact deterministic
row plan before touching business data. It accepts either reviewed bootstrap
executor's historical receipt shape without rewriting that history.

The strict manifest contains:

```json
{
  "version": "structr-homolog-read-proof-v1",
  "projectRef": "wmspwegbqtzamkhxhusg",
  "operationId": "<new lowercase nonzero UUID>",
  "withdrawalOperationId": "<different new lowercase nonzero UUID>",
  "sourceCommit": "<40 lowercase hexadecimal characters>",
  "identity": "<the complete exact homolog-identities-v1 manifest object>",
  "fixture": {
    "clientId": "<new lowercase nonzero UUID>",
    "projectId": "<new lowercase nonzero UUID>",
    "draftId": "<new lowercase nonzero UUID>",
    "membershipId": "<new lowercase nonzero UUID>"
  }
}
```

The `identity` placeholder above is an object, not a string in actual input; use
the exact manifest accepted by `parseHomologAccessManifest`. All operation,
tenant, internal profile, provider subject and fixture IDs must differ. Every
identity still has the original synthetic name/slug, role and mapping. No email,
password, bearer, database URL, arbitrary row value or SQL is accepted. Generate
IDs once; preserve the private manifest for uncertain outcomes and replay.

An input `projectRef` cannot authenticate a supplied database handle. A subject
UUID does not prove an Auth identity; a source commit does not attest a deployment.
Outputs therefore retain `authVerified:false` and `databaseTargetVerified:false`.

## Reviewed administrative connection runner

`homolog-access-runner.ts` supplies the separate administrative connection for
this helper. It has three explicit fixture commands, alongside the existing
identity `preflight` and `apply` commands:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C LC_ALL=C \
  pnpm exec tsx scripts/homolog-access-runner.ts read-proof-preflight \
  /private/path/read-proof.manifest.json /private/path/admin-connection.json
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C LC_ALL=C \
  pnpm exec tsx scripts/homolog-access-runner.ts read-proof-create \
  /private/path/read-proof.manifest.json /private/path/admin-connection.json
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C LC_ALL=C \
  pnpm exec tsx scripts/homolog-access-runner.ts read-proof-withdraw \
  /private/path/read-proof.manifest.json /private/path/admin-connection.json
```

Preflight verifies inputs and source without opening a network connection. The
outer `sourceCommit` must equal the committed runner checkout; all tracked
executable dependencies are compared to that commit and dirty/untracked source
siblings are refused. The nested `identity.sourceCommit` and complete historical
identity manifest retain the original bootstrap values. Do not rewrite history
to match the new runner. Keep HEAD and the manifest unchanged through creation,
withdrawal and their replays; an uncertain outcome is reconciled with the same
manifest and reviewed checkout.

The private owner-only connection file uses the existing runner schema and fixed
homolog direct host, database, user and port. TLS validates the hostname and
certificate chain; a supplied CA does not disable verification. Connection
policy is explicit, errors are allowlisted and the client closes on success or
failure. The runner calls the existing transactional/audited helper unchanged.
Successful execution adds `databaseTargetVerified:true` and
`targetVerification:"direct-host-verified-tls"`; `authVerified:false` remains
accurate. This file and process never enter the web runtime.

The [9 October hosted proof record](../docs/engineering/homolog-project-access-proof-2026-10-09.md)
tracks independent real-session evidence and its limits.

## Offline CLI and injected executors

```sh
pnpm exec tsx scripts/homolog-read-proof.ts validate /private/path/manifest.json
pnpm exec tsx scripts/homolog-read-proof.ts plan /private/path/manifest.json
```

The CLI reads one regular non-symlink file up to 64 KiB, emits only status,
operation IDs, a canonical manifest digest, counts and the two unverified flags.
It has no apply command, network call, connection factory or environment loader.
File/validation errors are fixed codes; input values and driver errors are not
echoed. The manifest is never modified.

`provisionHomologReadProof(db, manifest)` and
`withdrawHomologReadProof(db, manifest)` require an independently authorized,
destination-verified administrative Drizzle handle. Both literally call
`db.transaction()` at SERIALIZABLE isolation and await `logAudit(..., tx)` on
that same handle. Runtime SQL/service credentials are not introduced by this
tool. Effective isolation and unfiltered administrative row visibility are
checked inside the transaction; filtered table grants cannot stand in for an
administrative view.

No SQL renderer is delivered in the current candidate. The tested Drizzle
executor must not be described as a connector-ready SQL artifact. Preparing a
separate renderer requires its own exact-byte tests and review; the historical
SQL exception for O/issuer does not authorize a new business fixture executor.

## Exactly four business rows

Creation inserts C/P/D/M in this order:

1. A synthetic active client C in A, with contact/origin values null.
2. Project P in A, client C, owner A1, type `repair`, status `estimate`. Address,
   geography, pricing and operational values are null; committed/change-order
   cost counters are literally zero. The INSERT omits `provenance_state`; the
   real database trigger must classify the result as `formation_only`.
3. Draft D, version 1/status `draft`, client C/project P, source/author and
   financial values null, empty line-items and assembly selections, no approval,
   lock, lineage or fabricated calculation. Names/notes/metadata identify the run.
4. Membership M gives A2 `viewer` access to P with an empty permission array,
   active=true and createdBy=null. A1 is owner; B1 has no membership in A.

The plan explicitly supplies nullable/defaulted fields, including project
channel/city/state, rather than inheriting commercial defaults accidentally.
All modeled columns participate in readback; timestamp snapshots preserve
PostgreSQL microseconds. This is an administrative fixture, not an authenticated
creation attributed to A1: row audits have `user_id=null`, and the receipt records
the actual `current_user`/`session_user` as a database principal.

Creation commits four row audits and one completion receipt atomically. It does
not add intake, scope, geozones, catalog, calculation, approvals or exports.

## Replay, failures and withdrawal

Both operations take the original bootstrap advisory lock before the fixture
operation lock. New creation refuses ID collisions and existing business rows
in the synthetic tenants. The current bootstrap state must equal its historical
receipt; no upsert, identity rebind, implicit repair or adoption of existing data
is available.

Replay verifies the exact manifest digest, deterministic expected rows, all
operation audits and the complete receipt. Every new audit timestamp must equal
the transaction clock captured before mutation, at full microsecond precision.
Row-audit IDs returned by the real `logAudit` call are retained in the completion
receipt and compared on readback/replay. The bootstrap's six observed audit IDs
and timestamps are also frozen in that new receipt; their old timestamps must
share one transaction clock, without equating them to the different bootstrap
row-creation clock or rewriting the historical bootstrap.

Changed/missing evidence or business state is an error, including one-microsecond
timestamp drift. After the final receipt, `SET CONSTRAINTS ALL IMMEDIATE` flushes
pending deferred triggers before final readback and leaves them immediate. A
late trigger therefore cannot silently alter an earlier modeled row or audit.
The physical ID of the completion receipt is checked against `logAudit`'s return
before commit; its logical record identity is the operation UUID on replay. A
receipt cannot independently attest its own mutable physical ID or withstand an
administrator rewriting every copy of history; these records are not signatures.

Only SQLSTATE 40001/40P01 retries
the entire transaction, at most three attempts. Other errors are sanitized and
not retried. An unknown result must be reconciled with the same manifest/IDs.

Withdrawal requires successful unchanged creation first. It deactivates exactly
the original three profiles and two tenants, changes their updated timestamps,
records five before/after audits and one receipt, and preserves business rows,
provider mappings, bootstrap receipts and the history of read events. It refuses
unexpected profiles or C/P/D/M populations in either synthetic tenant. The human
operator's profile/tenant and issuer are never mutation targets. Replay verifies
the inactive state rather than treating reactivation as success; creation after
withdrawal is refused rather than resurrecting the fixture.

The population guard covers profiles and the four fixture business tables.
These synthetic tenants must remain reserved for this bounded test; this tool
does not inventory every unrelated domain before withdrawing them.

Membership removal alone is not a reliable revocation proof when global
`project:read` exists, and it does not remove A1's ownership. Profile/tenant
deactivation is the intended access withdrawal. Provider session logout is a
separate supported action; it does not guarantee immediate rejection of every
already-issued bearer before expiry.

## Local validation and remaining hosted work

The offline tests use no database. Opt-in physical tests create one owned
socket-only PostgreSQL 17 cluster, apply 0000–0017 with the documented contained
API baseline, and verify cleanup. They create no Auth schema, Auth users,
Auth sessions, signing keys or remote resources.

The two SQL-projection/decoder compatibility tests set synthetic claims locally
under the laboratory role. They test schema, RPC data shape and authorization
branches only: they do not verify a JWT signature or a real provider session.
This explicit limitation also applies to local cross-tenant and post-withdrawal
checks. Real A1/A2/B1 sessions, protected preview access and sanitized HTTP
receipts remain a separate hosted execution task.

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C LC_ALL=C NODE_ENV=test \
  APP_PRINCIPAL_LAB=1 HOMOLOG_READ_PROOF_PHYSICAL=1 \
  pnpm exec vitest run server/homolog-read-proof-physical.integration.test.ts \
  --maxWorkers=1 --minWorkers=1 --no-file-parallelism
```

No new business route, grant, RPC, migration or canonical domain enum is
introduced. Fixed protocol/action strings describe only this administrative
operation, following the existing bootstrap convention.

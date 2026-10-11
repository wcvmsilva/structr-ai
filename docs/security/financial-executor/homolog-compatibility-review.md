# Calculator managed-provider compatibility — compact review map

This is a closed local candidate. Metadata compatibility is exact snapshot equality, not authority to apply SQL, open a role, create credentials, or run hosted traffic. Independent security review and the separate concrete hosted confirmations remain required.

## Generated record inventory

`homolog-compatibility-manifest.json` has 1047 observed object records (1011 application objects and 36 pgcrypto members), 890 surface records, a duplicated 1011-record application projection for review, and three exact managed profiles (0/205/51 records). The `observation` is the authoritative complete observed snapshot; `application.objects` and `managed.profiles[].objects` are generated projections, not separately inferred permissions. Full generated bodies remain available.

The metadata capture is from a read-only PG17.11 transaction. A transport stripped four Unicode whitespace characters from two intake-string JSON envelopes; a separate read-only UTF8-hex recapture proved both original SHA256 envelopes and supplied only those exact definitions. Earlier raw observations remain unchanged as provenance. The pure suite compares the captured hosted sample to the fixed checked-in manifest and verifies each record's PostgreSQL JSONB SHA256; it does not regenerate expected records from an arbitrary current input. UTF8 byte ordering is explicit.

## Authority-critical review

- `pgcrypto`: exact extension identity/version1.3, dependency-proven36-member set, normalized native function bodies. Only proven extension member schema relocation is normalized. Application records are never removed by a name-only rule.
- Managed provider projection: exact205 records, including function definitions/config/ACL/static targets, schemas, relation and column ACLs, every default-ACL row regardless of owner/schema, extension members, views, rules, triggers and event-trigger bindings. Every addition/removal/body/ACL/default change blocks.
- Exact known latent ACLs: `extensions.pg_stat_statements` and `extensions.pg_stat_statements_info` retain PUBLIC SELECT. Financial principals have no extensions USAGE, no reachable wrapper and no actual SELECT access. These two exceptions do not exempt application raw privileges or other managed relations. Physical schema-USAGE/definer/ACL drift tests refuse atomically.
- Three nonapplication definers were semantically read: `pgbouncer.get_auth` reads pg_authid only, with owner-specific schema/EXECUTE; Vault create/update target only Vault secrets and native crypto. `vault.decrypted_secrets` view/_RETURN stays within Vault; no Vault triggers. No financial bridge exists in these bodies.
- `graphql_public.graphql` is an invoker PG-version error stub. Auth helpers are invoker setting readers. Storage/realtime functions run with caller authority; their dynamic role operations cannot grant a SET path the caller does not already possess. Four extension-trigger bindings have extension CREATE/DROP tags; two general DDL watchers only notify. No extension is installed by this candidate.
- Role graph review preserves existing service_role BYPASSRLS; it never grants that attribute to financial principals. API principals have no financial schema or entry-point privileges. Financial owner/login outgoing memberships remain forbidden. Database TEMP does not grant schema/function authority.

These are scoped semantic conclusions about the exact captured bodies and graph, not a generic provider exception. Collector review flags remain visible in the raw observation. `review.resolvedFindings` records the root's resolution of only the two named wrapper/TEMP questions for this exact snapshot; unknown future findings still block. The independent review status remains pending and `applicationAuthorization` remains false.

## Independent review fix: complete default ACL coverage

The v1 projection omitted defaults in public/structr_private/structr_financial while its contextual default guard could exempt a nonmigrator, nonfinancial owner. The v2 projection includes **every pg_default_acl row**, including six existing public records (postgres S/f/r and supabase_admin S/f/r). Provider coverage therefore grows199→205. The local fixture adds four explicitly approved public/private default records and grows47→51; positive physical installation verifies every one and the complete managed hash before/after. No ACL is revoked or broadly accepted to obtain compatibility.

Ten physical tests against preserved v1 source demonstrate acceptance of unauthorized default changes; the same tests reject against v2 across foundation/lifecycle/administrative preflight and public/private/financial schemas. Public functions/tables/sequences are represented. The original18 drift cases were strengthened: privileged fixture setup is separated from candidate phases running with current_user=session_user=postgres and rolsuper=false. The main positive installation still uses a real independent postgres connection without session identity changes. Focal results:29 pure +40 managed, all pass. TEMP2 retains its previously verified unchanged source.

## Installation and laboratory separation

The provider hash is accepted only as the exact205-record snapshot. Empty/51-record profiles additionally require a Unix-domain session, no listen_addresses, an exact `/private/tmp/structr-app-principal-pg-[A-Za-z0-9]+/socket` or `/tmp/` equivalent path, and an existing superuser `app_principal_runner`. Caller GUC markers have no effect. The owned harness independently verifies connection/file provenance. A changed bootstrap superuser identity is physically refused; TCP and nonmatching socket paths fail the explicit guard predicates (the harness deliberately exposes no TCP listener).

Actual non-superuser postgres creates roles with automatic incoming ADMIN true/INHERIT false/SET false edges. Closed installation temporarily adds own-grantor owner INHERIT true/SET true edges, without executing SET ROLE, and removes them before commit. The withdrawal helper temporarily supplies INHERIT true/SET false only around the caller's audited fixed revokes and verifies exact restoration. Runtime financial roles stay NOBYPASSRLS/NOINHERIT with no outgoing membership. Existing sessions are rejected by authorize_v1 after login closure or finite deadline expiration.

## Separate TEMP maintenance

`database-temp-containment-plan.json` enumerates every observed existing effective TEMP recipient and exact role/membership/database before/after metadata. Fixed SQL removes PUBLIC TEMP and adds explicit TEMP for enumerated recipients lacking owner/superuser/already-explicit preservation. Existing API/legacy-owner TEMP is retained; this is not a newly established ban in0015–19. No financial role receives TEMP, and incoming maintenance ADMIN-only edges do not inherit it.

`applyCalculatorDatabaseTempContainment` is the only proposed execution wrapper: actual postgres identity, PG17.11, one SERIALIZABLE transaction, fixed SQL SHA, exact before metadata, exact after metadata, `logAudit`, and exact audit readback. Audit failure rolls back the ACL. There is no runner or connection factory. The separate SQL is explicitly not a standalone authorized procedure. Physical proof uses the real SQL and non-superuser/audit transaction, with only the frozen expected metadata fixture substituted for its owned local cluster. Provider before/after records still require the exact future target check and separately confirmed maintenance authorization.

## Hashes

Application baseline1011: `45bf03ac2fac16724469de89f6a6d26effcf8919972406f99f6196fb2f2a9774`.
Foundation1099: `767369c0387f4a79316d9e0721841c5bccbeae44ba4a62e4fed1ba8148466650`.
Lifecycle1108: `75332da1e1b8d1492d1a99c702de39ddc8950c57f0c85c5726d11bed7d5acb2c`.
Provider managed205: `8622932ca244518fc2d29f50c952e7856d49ba9f556fda12a1b5e5813aad8b46`.

- `drizzle/0020_closed_financial_calculator_boundary.sql`: `a74b4d933bafe92c23ddaf3d5aee3487ce0e2197b03d10ae434280a268294d54`
- `drizzle/0021_financial_calculator_lifecycle.sql`: `87a09f22a4e433a75f2f01973b3ee903a0a1f9dd7ef0f0706860c5b8fe988c61`
- `scripts/financial-executor-homologation/preflight.sql`: `36c0d056b206f5daa0d3d7c3cc7cc8bcbb02932b0da1db302df49d73a91e2cb6`
- `scripts/financial-executor-homologation/catalog.sql`: `c42392fb01b6fde454e6237b35c136dbe4916616172dfa3ac5d087d050cf3002`
- `scripts/financial-executor-homologation/managed-catalog.sql`: `4699c4902bea791b030018fbba37be7c8e2911ff92d6e13eda0aacc2b1b1ae5f`
- `scripts/financial-executor-homologation/boundary.ts`: `9e7eebca19c6f2e6c2a3bb8342d7daf73ce213b4e2d3a1db513b1eec7ac9609c`
- `scripts/financial-executor-homologation/compatibility.ts`: `c57adea23b49a82c9e66a282938b968efc24a6346a614f80daaa8ba4738487d5`
- `scripts/financial-executor-homologation/compatibility-inspect.sql`: `5c8515d11bbae93b8823803d1ceba9aaae56bf37bbd516b88bc7947057c0e442`
- `scripts/financial-executor-homologation/compatibility-inspect-supplement.sql`: `90a586557fffabd7c20ab6239601dd88dce5a6dba38cb03b3d8ab66787205eb2`
- `scripts/financial-executor-homologation/database-temp-containment.sql`: `f45f2405759fa370e200d302e4037ce7ea6d04a296fe4d8bf224b12be4bb6e30`
- `scripts/financial-executor-homologation/temp-containment.ts`: `3082bdbc4f5b072fe06c0488538aad28defe686e55a1c37014f154145ec48efa`
- `scripts/financial-executor-homologation/contract.ts`: `7af2bbec59a7c0a4a5656a4c07f9b9c3f783397b022162a4ce2f9b9c62ca2cfe`
- `docs/security/financial-executor/permission-manifest.json`: `68aa6e678e778a800d8f31c4c998daddfea86888b7b66e5683de5e5d3fd3e999`
- `docs/security/financial-executor/homolog-compatibility-manifest.json`: `5230ef8f54db1f7dcfbf85925cc3dbe8542eec48711de5a3b911e15d25e0b006`
- `docs/security/financial-executor/database-temp-containment-plan.json`: `c40394b3b27f792891cded2040b1dd2e24c665c641233f9d74f7297829ae058a`
- `server/financial-executor-homologation-compatibility.test.ts`: `f645c9d8ec098d568b3ff7bd0952f184c5b32ee743a68086ce1610b46d8c38e7`
- `server/financial-calculator-hosted-compatibility-physical.test.ts`: `e0a8888158d5a3a52345374f86cebd12dddc9da7eecbeb1f3ce81a3d0e7fbb9e`
- `server/financial-calculator-temp-containment-physical.test.ts`: `b641df4d6827579165e2e4c5259837854f605bc36519a07bfaf1dee9793758c2`
- `server/test-support/app-principal-postgres.ts`: `6df4f78fd4ba848adff0822cb52104f5563788dd67c21e94ab86d091758f697d`
- `server/test-support/financial-calculator-boundary.ts`: `9f11d1269ad6b026405fa43af40a305551caccd00b1cbe8956f48df9e47a5a1b`
- `server/test-support/financial-calculator-boundary/managed-provider-fixture.sql`: `49befeb7d35cc0e599bd9d1703879551f3d085bfa610b8d78edbe9958d107031`
- `server/test-support/financial-calculator-boundary/pgcrypto-relocated.json`: `d5ce0a8de58e9080bb97c36b2ce93cb01d256ebaeb16693d292946d0595d9349`

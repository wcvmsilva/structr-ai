/** Owned PG17.11 laboratory; no external destination or credential inputs. */
import postgres from "postgres";
import { readFile, access, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { startAppPrincipalPostgres } from "./app-principal-postgres";

const root = new URL("../../", import.meta.url);
export const boundaryMigration = "0020_closed_financial_calculator_boundary";
export async function boundarySource() { return readFile(new URL(`drizzle/${boundaryMigration}.sql`, root), "utf8"); }
export async function startFinancialCalculatorBoundary() {
  if (process.env.FINANCIAL_CALCULATOR_BOUNDARY_PHYSICAL !== "1") throw new Error("Explicit boundary physical opt-in required");
  const cluster = await startAppPrincipalPostgres(postgres);
  const admin = cluster.observer.sql;
  const clients: ReturnType<typeof postgres>[] = [];
  try {
    const [identity] = await admin`SELECT current_setting('server_version_num') AS version, current_setting('app_principal_lab.nonce') AS nonce`;
    if (identity.version !== "170011") throw new Error("Requires real PostgreSQL 17.11");
    await admin.unsafe(`CREATE ROLE anon NOLOGIN NOBYPASSRLS; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT anon,authenticated,service_role TO authenticator WITH INHERIT FALSE, SET TRUE;`);
    const journal = JSON.parse(await readFile(new URL("drizzle/meta/_journal.json", root), "utf8"));
    const migrations: Array<{tag:string;sha256:string}> = [];
    for (const {tag} of journal.entries as Array<{tag:string}>) {
      if (Number(tag.slice(0,4))>19) continue;
      const source = await readFile(new URL(`drizzle/${tag}.sql`,root),"utf8");
      if (tag.startsWith("0015")) {
        let refusal:any;
        try { await admin.begin(async tx=>{ await tx.unsafe(source); }); } catch(error) { refusal=error; }
        if (refusal?.code!=="42501" || !refusal.message.startsWith("ADR002_BUSINESS_FUNCTION_PREFLIGHT:"))
          throw new Error("Uncontained legacy baseline was not refused as expected",{cause:refusal});
        const [partial] = await admin`SELECT to_regnamespace('structr_private') IS NOT NULL AS schema, to_regrole('structr_review_owner_v1') IS NOT NULL AS role`;
        if (partial.schema || partial.role) throw new Error("Legacy refused installation left partial objects");
        console.log("BOUNDARY_UNCONTAINED_BASELINE_REFUSED",refusal.code,refusal.message);
        await admin.begin(async tx=>{await tx.unsafe(await readFile(new URL("./financial-calculator-boundary/legacy-public-containment.sql",import.meta.url),"utf8"));});
      }
      await admin.begin(async tx=>{
        await tx.unsafe(source);
        if(tag.startsWith("0018")) await tx.unsafe(await readFile(new URL("docs/security/intake-formation/homolog-close.sql",root),"utf8"));
        if(tag.startsWith("0019")) await tx.unsafe(await readFile(new URL("docs/security/scope-workspace-read/homolog-close.sql",root),"utf8"));
      });
      migrations.push({tag,sha256:createHash("sha256").update(source).digest("hex")});
    }
    console.log("BOUNDARY_BASELINE",JSON.stringify({directory:cluster.directory,version:identity.version,migrations}));
    if(process.env.FINANCIAL_CALCULATOR_CAPTURE_BASELINE==="1") {
      const catalog=await admin.begin(async tx=>{await tx.unsafe("SET LOCAL search_path=pg_catalog");return tx.unsafe(await readFile(new URL("./financial-calculator-boundary/catalog.sql",import.meta.url),"utf8"));});
      await writeFile("/private/tmp/calculator-boundary-baseline-catalog.json",JSON.stringify(catalog,null,2));
    }
    async function install() {
      await admin.begin(async tx=>{await tx.unsafe(await boundarySource());});
      if(process.env.FINANCIAL_CALCULATOR_CAPTURE_INSTALLED==="1") {
        const source=(await readFile(new URL("./financial-calculator-boundary/catalog.sql",import.meta.url),"utf8")).replaceAll("('public','structr_private')","('public','structr_private','structr_financial')");
        const catalog=await admin.begin(async tx=>{await tx.unsafe("SET LOCAL search_path=pg_catalog");return tx.unsafe(source);});
        await writeFile("/private/tmp/calculator-boundary-installed-catalog.json",JSON.stringify(catalog,null,2));
      }
    }
    async function connectLogin() {
      // Explicit test-only opening of the otherwise NOLOGIN principal. No password.
      await admin.unsafe("ALTER ROLE structr_calculator_login_v1 LOGIN");
      const caller=await cluster.connect("financial-calculator-boundary", "structr_calculator_login_v1");
      console.log("BOUNDARY_LOGIN",JSON.stringify(await caller.sql`SELECT session_user,current_user,pg_backend_pid() AS pid`));
      return caller;
    }
    async function stop() {await Promise.allSettled(clients.map(c=>c.end({timeout:1})));await cluster.stop();if(await access(cluster.directory).then(()=>true,()=>false))throw new Error("Owned cluster directory not removed");console.log("BOUNDARY_CLEANUP",cluster.directory,"removed");}
    return {admin,cluster,migrations,install,connectLogin,stop};
  } catch(error) {await Promise.allSettled(clients.map(c=>c.end({timeout:1})));await cluster.stop();throw error;}
}

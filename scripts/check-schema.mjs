import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 5 });

const cols = await sql`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'assemblies' ORDER BY ordinal_position`;
console.log("=== ASSEMBLIES COLUMNS ===");
for (const c of cols) console.log(`${c.column_name} | ${c.data_type} | ${c.is_nullable} | ${c.column_default}`);

const cols2 = await sql`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'assembly_components' ORDER BY ordinal_position`;
console.log("\n=== ASSEMBLY_COMPONENTS COLUMNS ===");
for (const c of cols2) console.log(`${c.column_name} | ${c.data_type} | ${c.is_nullable} | ${c.column_default}`);

const rows = await sql`SELECT id, name, code, trade, category, assembly_type, directCost::text as cost, sellPrice::text as price, isActive FROM assemblies ORDER BY id`;
console.log("\n=== EXISTING ASSEMBLIES ===");
for (const r of rows) console.log(`[${r.id}] ${r.code} | ${r.name} | ${r.trade} | ${r.category} | ${r.assembly_type} | $${r.cost}/$${r.price} | active:${r.isActive}`);

await sql.end();

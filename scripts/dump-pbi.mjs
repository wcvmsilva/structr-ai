import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 5 });

const rows = await sql`SELECT id, sku, name, category, item_type, trade, unit_of_measure, unit_cost::text as cost, unit_price::text as price FROM price_book_items WHERE is_active = true ORDER BY category, name`;

for (const r of rows) {
  console.log(`${r.id}|${r.sku}|${r.name}|${r.category}|${r.item_type}|${r.trade}|${r.unit_of_measure}|${r.cost}|${r.price}`);
}
console.log(`\nTOTAL: ${rows.length} items`);
await sql.end();

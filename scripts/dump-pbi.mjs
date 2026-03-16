import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(`SELECT id, sku, name, category, item_type, trade, unit_of_measure, CAST(unit_cost AS CHAR) as cost, CAST(unit_price AS CHAR) as price FROM price_book_items WHERE is_active = 1 ORDER BY category, name`);

for (const r of rows) {
  console.log(`${r.id}|${r.sku}|${r.name}|${r.category}|${r.item_type}|${r.trade}|${r.unit_of_measure}|${r.cost}|${r.price}`);
}
console.log(`\nTOTAL: ${rows.length} items`);
await conn.end();

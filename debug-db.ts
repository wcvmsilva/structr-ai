import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { catalogItems } from "./drizzle/schema";

async function main() {
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: 1,
  });
  const db = drizzle(pool);
  const items = await db.select().from(catalogItems).limit(5);
  console.log(`Found ${items.length} items.`);
  if (items.length > 0) {
    console.log(items[0]);
  }
  process.exit(0);
}
main();

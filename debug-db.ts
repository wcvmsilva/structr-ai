import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { catalogItems } from "./drizzle/schema";

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const items = await db.select().from(catalogItems).limit(5);
  console.log(`Found ${items.length} items.`);
  if (items.length > 0) {
    console.log(items[0]);
  }
  await client.end();
  process.exit(0);
}
main();

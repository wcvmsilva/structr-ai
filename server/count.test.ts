import { it, expect } from "vitest";
import "./_core/env";
import { getDb } from "./db";
import { costCodes } from "../drizzle/schema";

it.skipIf(!process.env.DATABASE_URL)("counts catalog items", async () => {
  const db = await getDb();
  if (!db) throw new Error("db is null");
  const items = await db.select().from(costCodes);
  console.log("DB ITEMS COUNT: ", items.length);
  expect(items.length).toBeGreaterThan(0);
});

import { it } from "vitest";

it("prints env", () => {
  console.log("DATABASE_URL INSIDE VITEST:", process.env.DATABASE_URL);
  console.log("NODE_ENV:", process.env.NODE_ENV);
});

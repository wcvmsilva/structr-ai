import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCspDirectives } from "./_core/csp";

const config = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8")
);

/** Evaluate only declared universal/exact path rules; this is not a live CDN check. */
function cdnHeaders(
  path: string,
  includeExactPaths = false
): Map<string, string> {
  const headers = new Map<string, string>();
  const pathname = new URL(path, "https://synthetic.invalid").pathname;
  for (const rule of config.headers ?? []) {
    // Security checks keep requiring universal coverage. Cache checks also allow
    // the exact HTML paths; conditional rules and other patterns never count.
    if (rule.has?.length || rule.missing?.length) continue;
    if (
      rule.source !== "/(.*)" &&
      !(includeExactPaths && rule.source === pathname)
    )
      continue;
    for (const header of rule.headers)
      headers.set(header.key.toLowerCase(), header.value);
  }
  return headers;
}

function parsePolicy(value: string) {
  return Object.fromEntries(
    value
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
      })
  );
}

describe("native hosted CDN response header contract", () => {
  it.each([
    "/",
    "/?verification=synthetic",
    "/index.html",
    "/index.html?verification=synthetic",
  ])("declares no-store for the static HTML entry at %s", path => {
    expect(cdnHeaders(path, true).get("cache-control")).toBe("no-store");
  });
  it.each([
    "/assets/synthetic.js",
    "/assets/synthetic.css",
    "/assets/synthetic.svg",
  ])("does not override the CDN cache policy for %s", path => {
    expect(cdnHeaders(path, true).has("cache-control")).toBe(false);
  });
  it.each(["/", "/index.html", "/projects/synthetic", "/assets/synthetic.js"])(
    "protects %s even when the CDN bypasses Express",
    path => {
      const headers = cdnHeaders(path);
      expect(headers.get("x-frame-options")).toBe("DENY");
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin"
      );
      const policy = headers.get("content-security-policy-report-only");
      expect(policy).toBeTypeOf("string");
      // Compare semantic directives to the existing production policy, with no
      // optional environment-specific report endpoint or Supabase socket origin.
      const expected = Object.fromEntries(
        Object.entries(
          buildCspDirectives({
            isDevelopment: false,
            supabaseUrl: "",
            reportUri: "",
          })
        ).map(([key, values]) => [
          key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`),
          values,
        ])
      );
      expect(parsePolicy(policy!)).toEqual(expected);
      expect(parsePolicy(policy!)["frame-ancestors"]).toEqual(["'none'"]);
      expect(parsePolicy(policy!)["script-src"]).not.toContain("'unsafe-eval'");
      // A new enforced policy would bypass the existing progressive rollout.
      expect(headers.has("content-security-policy")).toBe(false);
    }
  );
});

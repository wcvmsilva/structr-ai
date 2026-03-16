# structr.ai

**Deterministic Construction Estimation System**

Enterprise-grade construction estimation platform built for GC Home Improvement LLC (Charleston, SC). Features 7 deterministic engines, 51 database tables, and a complete pipeline from client intake to JobTread CSV export.

## Architecture

- **Stack:** React 18 + TypeScript + tRPC + Drizzle ORM + PostgreSQL + Tailwind CSS + shadcn/ui
- **Engines:** Scope Builder, Remodel Engine, Pricing Engine, Override Resolver, Export Engine, Audit Engine, Learning Layer
- **Pipeline:** 10-step deterministic flow from intake → scope → review → estimate → export
- **Coverage:** 1,944 tests across 30 test files, zero regressions

## Features

- Multi-channel support (Residential/Commercial/Insurance)
- 9 service types (Kitchen, Bathroom, Roofing, Siding, Windows/Doors, Deck/Porch, Painting, Flooring, Exterior)
- Geographic intelligence with Charleston coastal zone overrides
- Profit Shield floor protection (35% GP minimum)
- JobTread CSV export compliance
- Variance analysis and learning layer for continuous calibration
- Comprehensive audit logging

## Development

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## Confidential

This repository contains proprietary business logic, pricing models, and competitive intelligence for GC Home Improvement LLC. All rights reserved.

---

*Powered by structr.ai — Charleston, SC — 2026*

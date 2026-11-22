# OptiFlow

Production-floor management for **De Otro Tiempo**: work orders, stage timing,
operator roster, quality (QMS), preventive maintenance (TPM) and the technical
office (despiece).

Migrated from an Express + Supabase backend to the Next.js App Router. Data
access is `pg` only — no ORM, no query builder, no UI component library.

## Requirements

- **Node.js >= 20.9** (the version Next.js 16 requires)
- A **PostgreSQL** database (Supabase-compatible; RLS is enabled on the access
  tables)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create the local environment file and fill in SUPABASE_DB_URL
cp .env.example .env.local

# 3. Apply the schema (idempotent, safe to re-run)
npm run db:esquema

# 4. Seed the base data (idempotent, safe to re-run)
npm run db:seed

# 5. Start the development server
npm run dev
```

Open <http://localhost:3000>. Without a session the app redirects to `/login`.

### First login

`npm run db:seed` guarantees an active `admin` user:

- If `OPTIFLOW_ADMIN_PASSWORD` has a value, that password is used.
- Otherwise the seed generates one and prints it **once**; it is never written
  to disk, so store it immediately.
- Re-running the seed never rotates an existing password unless the variable is
  set, so a working login is not broken by seeding again.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload. |
| `npm run build` | Production build. |
| `npm run start` | Serves the production build. |
| `npm run lint` | ESLint over the whole repository. |
| `npm run db:esquema` | Applies every `db/*.sql`, in filename order, one transaction per file. |
| `npm run db:seed` | Seeds the 16 base sectors and an active administrator. |

## Environment variables

All variables are documented in `.env.example`. Only `SUPABASE_DB_URL` is
required; the rest have defaults in code.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SUPABASE_DB_URL` | — | PostgreSQL connection string. |
| `PG_POOL_MAX` | `10` | Maximum pool connections. |
| `PG_IDLE_MS` | `30000` | Idle connection timeout. |
| `PG_CONNECT_MS` | `10000` | Connection attempt timeout. |
| `OPTIFLOW_LOGIN_MAX` | `8` | Login attempts per IP + user in 15 minutes. |
| `OPTIFLOW_SESION_HORAS` | `12` | Session lifetime in hours. |
| `OPTIFLOW_ADMIN_USER` | `admin` | Username created by the seed. |
| `OPTIFLOW_ADMIN_NAME` | `Administrador` | Display name created by the seed. |
| `OPTIFLOW_ADMIN_PASSWORD` | generated | Password created by the seed. |

## Database

The schema is a versioned artifact, not a boot hook: a Next.js server has no
single startup point, so creating tables at runtime would race itself.

```
db/
├── 000_base.sql            production floor + operators + users + sessions
├── 001_calidad_tpm.sql     QMS (no conformidades) and TPM (máquinas)
├── 002_despiece.sql        technical office (módulos, piezas, herrajes)
├── env.js                  shared `.env.local` loader
├── run-schema.js           applies the files, one transaction per file
└── seed.js                 idempotent base data
```

Rules every file follows:

1. **Idempotent** — `create table if not exists`, `create index if not exists`,
   `on conflict do nothing`. The runner also runs against a populated database.
2. **No `BEGIN`/`COMMIT`** — the runner wraps each file in its own transaction
   and rejects any file that opens one, because a nested `COMMIT` would close
   the runner's transaction early and break the all-or-nothing guarantee.
3. **Dates are `text` ISO-8601 UTC** and boolean flags are `smallint` 0/1. The
   application compares `substr(fecha, 1, 10)`, so switching to `timestamptz`
   would shift every date comparison.

## Authorization

`src/proxy.ts` is only an optimistic perimeter check: it looks at whether the
session cookie exists, without touching the database.

Real authorization lives next to the data:

- `requireSession()` → `401` when there is no valid, unexpired session.
- `requireGestion()` → `403` when the role is not `admin` or `encargado`
  (`src/lib/session-server.ts`). The error body keeps the `accion` field the rest
  of the API uses.

Reading the floor is open to any session. Master-data writes (work orders,
materials, operators, QMS resolution, TPM writes) require a management role.

## Project layout

```
src/
├── app/
│   ├── (app)/           dashboard, órdenes, operarios, sectores, calidad, mantenimiento
│   ├── actions/         Server Actions (validate session + role on every call)
│   ├── api/             REST handlers (auth, órdenes, operarios, qms, tpm, despiece)
│   └── login/
├── lib/
│   ├── db.ts            lazy `pg` pool + `withTransaction` with advisory locks
│   ├── auth.ts          scrypt hashing, session tokens, login throttling
│   ├── session-server.ts requireSession / requireGestion
│   └── *-db.ts          one data layer per module
└── proxy.ts             session-cookie guard
```

## Verification

Before opening a pull request:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

TypeScript is strict: no `any` and no `@ts-ignore`.

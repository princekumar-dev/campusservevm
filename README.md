<div align="center">

<img src="public/images/camlogo.webp" alt="CampusServe logo" width="120">

# CampusServe VM

### Multi-Institution Campus Procurement & Service Management Platform

**From service request to payment — one audited workflow for campuses**

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38B2AC?logo=tailwindcss&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-31_tables-4169E1?logo=postgresql&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Web_Push-5A0FC8?logo=pwa&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-Vitest-729B1B?logo=vitest&logoColor=white)
![Deploy](https://img.shields.io/badge/Deploy-Vercel_%7C_Render_%7C_Ubuntu_VM-black)

</div>

---

## 📖 Overview

**CampusServe VM** is a full-stack web platform that digitises how educational institutions handle
**service requests, procurement, deliveries, gate verification, and payments**. A request raised by
a faculty member flows through an enforced state machine — quotation → approval → purchase order →
QR-verified delivery at the gate → goods receipt → invoice → payment — with every transition
logged, notified, and auditable.

The platform is **multi-institution** (MSEC, The Nest School, MSSM, IIET) with per-institution
units, labels, and role semantics, and ships as a **progressive web app** so staff can work from
phones as easily as desktops.

## ✨ Features

### 🔄 Request-to-Payment Workflow
- **State-machine engine** (`lib/workflowEngine.js`) with enforced transitions — requests cannot skip approval steps
- **Full lifecycle**: `DRAFT → SUBMITTED → APPROVED → QUOTATION → WORK_ORDER → IN_PROGRESS → SERVICE_VERIFIED → INVOICE → PAYMENT → CLOSED`, plus clarification, revision, pause, reopen and cancellation paths
- **Role-owned states** — every status has exactly one responsible role (admin, manager, accounts…)
- Status history tables record who changed what, and when

### 🛒 Procurement & Vendors
- **Vendor directory** with quotations and item-level quote comparison
- **Purchase orders** with PDF export (Tamil + Latin fonts via Noto Sans Tamil), status history and expense tracking
- **Work orders** with materials, additional-cost capture and progress updates

### 🚪 Gate & Logistics
- **QR-verified gate entry** — signed PO QR tokens (`PO_QR_SECRET`) validated at the gate
- **Geofenced check-in** (`lib/gateGeofence.js`) so verification only counts at the campus location
- Delivery persons, vehicles and scheduled deliveries with per-stage status tracking
- **GRN (goods receipt)** with item-level acceptance and damage reporting

### 💰 Accounts & Invoices
- Vendor invoices with line items, payment tracking and service-request payment records
- Accounts dashboard for pending invoices and payment status

### 🔔 Notifications (three channels)
- **WhatsApp** via Evolution API (instance-based messaging)
- **Email** via Resend or SMTP, with email-verification flows
- **Web push** (VAPID + service worker) with per-user notification settings

### 📊 Dashboards & Reporting
- Role-specific dashboards: Admin, Manager, Gate, Service, Accounts, Vendor, Requester/HOD
- KPI cards, charts (Recharts) and exportable reports

### 🔐 Security & Audit
- JWT auth + bcrypt hashing, email verification, helmet headers, CORS allow-list, rate limiting
- Signed QR tokens and email-verification secrets kept separate from `JWT_SECRET`
- **`audit_logs` table + Admin Audit page** — every sensitive action is traceable

## 🏫 Multi-Institution Support

| Institution | Unit label | Example units |
|---|---|---|
| MSEC | Department | CSE, ECE, MECH, CIVIL, IT, EEE, AIDS |
| The Nest School | School Section | Early Years, Primary, Middle, Secondary |
| MSSM | Management Department | Finance, Marketing, HR, Operations |
| IIET (legacy `iic`) | Innovation Function | Innovation Council, Startup, Entrepreneurship |

Institution users (requester / staff / HOD) are scoped to their institution and unit.

## 🗄️ Data Model (PostgreSQL — 31 tables)

`users` · `service_requests` (+ evidence & status history) · `vendors` · `vendor_quotations` (+ items) ·
`purchase_orders` (+ items, history, expenses, work evidence) · `delivery_persons` · `vehicles` ·
`delivery_schedules` (+ items, history) · `gate_entries` · `goods_receipts` (+ items) ·
`work_order_updates/materials/additional_costs` · `invoice_items` · `service_request_payments` ·
`notifications` · `push_subscriptions` · `audit_logs` · `email_verifications` · `system_settings`

Full DDL lives in [`schema.sql`](schema.sql). A one-shot MongoDB → PostgreSQL migration script is
included (`npm run migrate:mongo-to-postgres` — see [MONGO_TO_POSTGRES_MIGRATION.md](MONGO_TO_POSTGRES_MIGRATION.md)).

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, React Router, Recharts, Lucide icons, PWA (service worker + web push) |
| Backend | Node.js + Express (`server.js`), serverless-ready endpoints in `api/` (Vercel) |
| Database | PostgreSQL (`pg`), SQL-first schema, LRU caching |
| Auth | JWT, bcryptjs, email verification |
| Notifications | Evolution API (WhatsApp), Resend/SMTP (email), Web Push (VAPID) |
| Documents | PDFKit (POs/invoices with Tamil fonts), QR codes, JSZip exports |
| Security | helmet, express-rate-limit, CORS allow-list, signed tokens, audit logging |
| Quality | Vitest (unit + component tests), smoke tests, performance tests, deployment verifier |

## 🚀 Getting Started

### Prerequisites
- **Node.js 18+**
- **PostgreSQL 14+** (local or hosted)

### Installation

```bash
git clone https://github.com/princekumar-dev/campusservevm.git
cd campusservevm
npm install
```

### Configure environment

```bash
cp .env.example .env
# then edit .env — the essentials:
#   DATABASE_URL=postgresql://user:password@localhost:5432/campusserve
#   JWT_SECRET=<long random>
#   PO_QR_SECRET=<a different long random>
#   EMAIL_VERIFICATION_SECRET=<a third long random>
```

Optional channels: `EVOLUTION_API_URL/KEY/INSTANCE_NAME` (WhatsApp), `RESEND_API_KEY` or
`SMTP_*` (email), `VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY` (web push — generate with
`npx web-push generate-vapid-keys`).

### Initialise the database

```bash
npm run init:postgres        # creates tables from schema.sql
npm run seed-users           # optional starter users
npm run ensure-super-admin   # guarantees an admin account
npm run ensure-gate-service-users
```

### Run

```bash
npm run dev:full   # API (:3001) + Vite dev server (:3000) together
# or separately:
npm run server     # Express API
npm run dev        # Vite frontend
```

### Test

```bash
npm run test:run        # Vitest suite (workflow engine, geofence, QR tokens, receiving…)
npm run test:coverage
```

## ☁️ Deployment

| Target | How | Guide |
|---|---|---|
| **Vercel** | Serverless `api/` endpoints + built frontend | [vercel.json](vercel.json) |
| **Render** | Full-stack service from `render.yaml` | [DEPLOYMENT_RENDER.md](DEPLOYMENT_RENDER.md) |
| **Ubuntu VM** | nginx reverse proxy + systemd services + backup timer | [VM_DEPLOYMENT.md](VM_DEPLOYMENT.md), [`deploy/`](deploy/) |
| **CI builds** | GitHub Actions build with optional Brotli/Gzip artifacts | [.github/workflows/build.yml](.github/workflows/build.yml) |

After deploying, run the built-in verifier:

```bash
npm run verify:deployment
```

## 📚 Documentation

| Guide | Covers |
|---|---|
| [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md) | Official service workflow, SLA & evidence policy, role queues |
| [TESTING_QUICKSTART.md](TESTING_QUICKSTART.md) | Running and writing tests |
| [MONGO_TO_POSTGRES_MIGRATION.md](MONGO_TO_POSTGRES_MIGRATION.md) | Database migration walkthrough |
| [DEPLOYMENT_RENDER.md](DEPLOYMENT_RENDER.md) / [VM_DEPLOYMENT.md](VM_DEPLOYMENT.md) | Hosting setup |
| [NOTIFICATION_SYSTEM_IMPROVEMENTS.md](NOTIFICATION_SYSTEM_IMPROVEMENTS.md) | Notification architecture |
| [design_system_guide.md](design_system_guide.md) / [design-qa.md](design-qa.md) | UI conventions & QA notes |
| [FIX_CORS_NOW.md](FIX_CORS_NOW.md) / [IMAGE_OPTIMIZATION.md](IMAGE_OPTIMIZATION.md) / [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) | Ops playbooks & change summaries |

Visual QA screenshots of every role dashboard live in [`audit-output/`](audit-output/).

## 📁 Project Structure

```
campusservevm/
├── api/                  # Serverless API endpoints (auth, POs, GRN, invoices, payments…)
├── backend/              # Extended modules (deliveries, gate, GRN, POs, vendors…)
├── lib/                  # Core services: auth, workflow engine, notifications, geofence, QR
├── src/                  # React app
│   ├── components/       # UI kit (glass panels, KPI cards, bottom nav, modals…)
│   ├── pages/            # Role dashboards: Admin, Manager, Gate, Service, Accounts, Vendor…
│   ├── hooks/            # Pull-to-refresh, push notifications, intersection observer
│   └── utils/            # API client, auth, notification events, workflow guidance
├── db/                   # PostgreSQL client
├── scripts/              # Init, seed, migration, smoke/performance tests, image conversion
├── deploy/               # nginx, systemd units, backup scripts, Ubuntu setup
├── public/               # PWA assets, icons, institution logos, service worker
├── schema.sql            # Full PostgreSQL DDL (31 tables)
├── server.js             # Express server entry
└── render.yaml / vercel.json   # Deployment blueprints
```

## 🤝 Contributing

1. Fork and create a feature branch: `git checkout -b feature/your-feature`
2. Follow the existing structure and add tests for new logic
3. Commit with a clear message and open a Pull Request

## 📄 License

No license file has been declared yet. All rights reserved by the author unless stated otherwise —
reach out before reusing.

## 👤 Author

**Prince Kumar** — [@princekumar-dev](https://github.com/princekumar-dev)

Built for the **Meenakshi Sundararajan Engineering College (MSEC)** community and partner institutions
(The Nest School, MSSM, IIET) — Chennai, Tamil Nadu, India.

---

<div align="center">
<sub><b>CampusServe VM</b> — campus operations, one audited workflow at a time.</sub>
</div>

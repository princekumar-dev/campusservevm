# MongoDB to PostgreSQL migration

The application currently has 14 Mongoose models: `User`, `ServiceRequest`,
`Notification`, `Vendor`, `VendorQuotation`, `PurchaseOrder`, `DeliveryPerson`,
`Vehicle`, `DeliverySchedule`, `GateEntry`, `GoodsReceipt`, `AuditLog`,
`EmailVerification`, and `SystemSettings`. `push_subscriptions` is also a
MongoDB collection used directly by the notification service.

The models contain substantial nested data: request evidence, status history,
quotation/invoice/payment lines, PO lines and execution records, delivery lines,
GRN lines, and audit `details`. A lossless first migration is therefore stored
as PostgreSQL `jsonb`, rather than flattening embedded arrays and risking a
partial transfer. Every Mongo document receives a row with its original
`mongo_id` and canonical Extended JSON `document` in the
`campusserve_mongo_backup` schema. ObjectIds, BSON dates, nested arrays, and
other BSON types are preserved exactly.

No MongoDB delete, update, collection drop, or index change is performed. The
script only reads MongoDB and writes to PostgreSQL. It is idempotent: re-running
it upserts rows by original Mongo `_id` and refreshes the manifest.

## Run

1. Provision an empty PostgreSQL database and set `POSTGRES_URL` to its full
   connection URL. Do not put its credential in source control.
2. Ensure the MongoDB Atlas project allows this machine's outbound IP and that
   the Atlas replica set has a reachable primary.
3. Run:

   ```powershell
   $env:POSTGRES_URL = 'postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require'
   npm run migrate:mongo-to-postgres
   ```

The terminal prints a source/copy/destination count for each collection and
fails if PostgreSQL has fewer rows than MongoDB. Final counts are recorded in
`campusserve_mongo_backup.migration_manifest`.

This copies data only. Switching the Express API from Mongoose to PostgreSQL is
a separate application migration and should happen after the copied data is
validated.

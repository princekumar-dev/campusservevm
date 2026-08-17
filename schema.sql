-- CampusServe Pro - PostgreSQL Schema
-- Converted from MongoDB/Mongoose schemas

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'requester', 'manager', 'technician', 'accounts', 'vendor', 'service_provider', 'super_admin', 'gate', 'receiving_officer', 'delivery_person', 'hod', 'staff')),
  name VARCHAR(255) NOT NULL,
  institution VARCHAR(20) CHECK (institution IN ('msec', 'nest', 'mcw', 'mssm', 'iic')),
  department VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50),
  esignature TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_role_active_name ON users (role, is_active, name);

-- ─── Service Requests ────────────────────────────────────────────────────────
CREATE TABLE service_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_number VARCHAR(50) NOT NULL UNIQUE,
  institution VARCHAR(20) NOT NULL DEFAULT 'msec' CHECK (institution IN ('msec', 'nest', 'mcw', 'mssm', 'iic')),
  title VARCHAR(500) NOT NULL,
  category VARCHAR(100) NOT NULL,
  location VARCHAR(255) NOT NULL,
  asset_code VARCHAR(50),
  priority VARCHAR(20) NOT NULL DEFAULT 'LOW' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY')),
  emergency_reason TEXT,
  requested_item VARCHAR(255),
  requested_quantity INTEGER CHECK (requested_quantity >= 1),
  requested_unit VARCHAR(50) DEFAULT 'pcs',
  description TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',

  requester_id UUID NOT NULL REFERENCES users(id),
  requester_name VARCHAR(255) NOT NULL,
  requester_email VARCHAR(255) NOT NULL,

  assigned_manager_id UUID REFERENCES users(id),
  assigned_manager_name VARCHAR(255),
  selected_quotation_id UUID,
  assigned_manager_email VARCHAR(255),

  current_owner_role VARCHAR(50),
  sla_due_at TIMESTAMPTZ,
  is_escalated BOOLEAN NOT NULL DEFAULT FALSE,

  submitted_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  -- Admin assessment (JSONB for subdocument)
  admin_assessment JSONB DEFAULT '{}',

  -- Inspection (JSONB)
  inspection JSONB DEFAULT '{}',

  -- Quotation snapshot (JSONB)
  quotation JSONB DEFAULT '{}',

  -- Work order (JSONB)
  work_order JSONB DEFAULT '{}',

  -- Requester verification (JSONB)
  requester_verification JSONB DEFAULT '{}',

  -- Invoice (JSONB)
  invoice JSONB DEFAULT '{}',

  -- Evidence attachments (JSONB array)
  evidence JSONB DEFAULT '[]',

  -- Status history (JSONB array)
  status_history JSONB DEFAULT '[]',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_requests_status ON service_requests (status);
CREATE INDEX idx_service_requests_requester ON service_requests (requester_id);
CREATE INDEX idx_service_requests_requester_created ON service_requests (requester_id, created_at DESC);
CREATE INDEX idx_service_requests_manager ON service_requests (assigned_manager_id);
CREATE INDEX idx_service_requests_manager_created ON service_requests (assigned_manager_id, created_at DESC);
CREATE INDEX idx_service_requests_created ON service_requests (created_at DESC);
CREATE INDEX idx_service_requests_status_created ON service_requests (status, created_at DESC);
CREATE INDEX idx_service_requests_owner_sla ON service_requests (current_owner_role, sla_due_at);
CREATE INDEX idx_service_requests_updated ON service_requests (updated_at DESC);

-- ─── Service Request Evidence (separate table for array) ─────────────────────
CREATE TABLE service_request_evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  kind VARCHAR(50) NOT NULL DEFAULT 'OTHER' CHECK (kind IN ('ISSUE_PHOTO', 'QUOTATION', 'WORK_PHOTO', 'INVOICE', 'RECEIPT', 'OTHER')),
  note TEXT,
  uploaded_by VARCHAR(255),
  uploaded_by_role VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evidence_request ON service_request_evidence (request_id);

-- ─── Service Request Status History ──────────────────────────────────────────
CREATE TABLE service_request_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  actor_id VARCHAR(100),
  actor_name VARCHAR(255),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sr_status_history_request ON service_request_status_history (request_id);

-- ─── Notifications ───────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  user_email VARCHAR(255) NOT NULL,
  type VARCHAR(50) DEFAULT 'info',
  title VARCHAR(500) NOT NULL,
  message TEXT NOT NULL,
  url VARCHAR(500) DEFAULT '/',
  read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_email_read ON notifications (user_email, read, created_at DESC);

-- ─── Push Subscriptions ──────────────────────────────────────────────────────
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_email VARCHAR(255) NOT NULL,
  subscription JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(50) DEFAULT 'active',
  status_updated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  deactivated_reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_push_sub_endpoint ON push_subscriptions ((subscription ->> 'endpoint'));
CREATE INDEX idx_push_sub_email ON push_subscriptions (user_email, active);

-- ─── Vendors ─────────────────────────────────────────────────────────────────
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_code VARCHAR(50) NOT NULL UNIQUE,
  legal_name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  pan_number VARCHAR(10),
  tax_number VARCHAR(50),
  address TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'BLACKLISTED')),
  rating NUMERIC(3,1) NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255)
);

CREATE INDEX idx_vendors_status_name ON vendors (status, legal_name);
CREATE INDEX idx_vendors_email ON vendors (email);
CREATE INDEX idx_vendors_pan ON vendors (pan_number) WHERE pan_number IS NOT NULL;

-- ─── Vendor Quotations ───────────────────────────────────────────────────────
CREATE TABLE vendor_quotations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_number VARCHAR(50) NOT NULL UNIQUE,
  request_id UUID NOT NULL REFERENCES service_requests(id),
  request_number VARCHAR(50),
  request_title VARCHAR(500),
  assigned_manager_id UUID REFERENCES users(id),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  vendor_name VARCHAR(255) NOT NULL,
  vendor_code VARCHAR(50),
  vendor_email VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SELECTED', 'NOT_SELECTED')),
  selected BOOLEAN NOT NULL DEFAULT FALSE,
  selected_by VARCHAR(255),
  selected_at TIMESTAMPTZ,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  valid_until TIMESTAMPTZ,
  terms TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vq_request_vendor ON vendor_quotations (request_id, vendor_id, created_at DESC);
CREATE INDEX idx_vq_manager ON vendor_quotations (assigned_manager_id, created_at DESC);
CREATE INDEX idx_vq_created ON vendor_quotations (created_at DESC);

-- ─── Vendor Quotation Items ──────────────────────────────────────────────────
CREATE TABLE vendor_quotation_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id UUID NOT NULL REFERENCES vendor_quotations(id) ON DELETE CASCADE,
  item_type VARCHAR(20) NOT NULL DEFAULT 'MATERIAL' CHECK (item_type IN ('MATERIAL', 'LABOUR', 'SERVICE')),
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL
);

CREATE INDEX idx_vqi_quotation ON vendor_quotation_items (quotation_id);

-- ─── Purchase Orders ─────────────────────────────────────────────────────────
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number VARCHAR(50) NOT NULL UNIQUE,
  qr_token_hash VARCHAR(255),
  qr_issued_at TIMESTAMPTZ,
  request_id UUID REFERENCES service_requests(id),
  vendor_id UUID REFERENCES vendors(id),
  vendor_name VARCHAR(255),
  vendor_email VARCHAR(255),
  vendor_address TEXT,
  service_provider_id UUID REFERENCES users(id),
  service_provider_name VARCHAR(255),
  service_provider_email VARCHAR(255),
  admin_requirement_type VARCHAR(50),
  po_type VARCHAR(20) CHECK (po_type IN ('SERVICE', 'GOODS', 'REPLACEMENT')),
  admin_description TEXT,
  admin_assessment_note TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED_FOR_APPROVAL','APPROVED','SENT_TO_VENDOR','VENDOR_ACCEPTED','ACTIVE','PARTIALLY_FULFILLED','FULFILLED','CLOSED','REVISION_REQUIRED','REJECTED','VENDOR_REJECTED','CANCELLED')),
  billing_address TEXT DEFAULT 'MSEC Campus, Chennai',
  delivery_address TEXT NOT NULL,
  delivery_location VARCHAR(255),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_delivery_date TIMESTAMPTZ,
  payment_terms VARCHAR(255) DEFAULT 'Net 30',
  warranty_terms TEXT,
  notes TEXT,
  created_by VARCHAR(255),
  created_by_id VARCHAR(100),
  approved_by VARCHAR(255),
  approved_at TIMESTAMPTZ,
  vendor_accepted_at TIMESTAMPTZ,
  vendor_rejection_reason TEXT,
  document_url TEXT,

  -- Line items (JSONB array)
  items JSONB DEFAULT '[]',

  -- Signed PO (JSONB)
  signed_po JSONB DEFAULT '{}',

  -- Service Execution (JSONB)
  service_execution JSONB DEFAULT '{}',

  -- Status history (JSONB array)
  status_history JSONB DEFAULT '[]',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_po_status ON purchase_orders (status);
CREATE INDEX idx_po_vendor ON purchase_orders (vendor_id);
CREATE INDEX idx_po_request ON purchase_orders (request_id);
CREATE INDEX idx_po_created ON purchase_orders (created_at DESC);
CREATE INDEX idx_po_created_by ON purchase_orders (created_by_id, created_at DESC);
CREATE INDEX idx_po_status_created ON purchase_orders (status, created_at DESC);
CREATE INDEX idx_po_vendor_created ON purchase_orders (vendor_id, created_at DESC);
CREATE INDEX idx_po_request_created ON purchase_orders (request_id, created_at DESC);

-- ─── Purchase Order Items ────────────────────────────────────────────────────
CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id VARCHAR(50),
  description VARCHAR(500) NOT NULL,
  specification TEXT,
  brand VARCHAR(100),
  model VARCHAR(100),
  quantity_ordered INTEGER NOT NULL,
  quantity_accepted INTEGER NOT NULL DEFAULT 0,
  quantity_remaining INTEGER,
  unit VARCHAR(50) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL
);

CREATE INDEX idx_poi_po ON purchase_order_items (po_id);

-- ─── Purchase Order Status History ───────────────────────────────────────────
CREATE TABLE purchase_order_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  actor_id VARCHAR(100),
  actor_name VARCHAR(255),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_po_status_history_po ON purchase_order_status_history (po_id);

-- ─── Delivery Persons ────────────────────────────────────────────────────────
CREATE TABLE delivery_persons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  id_type VARCHAR(30) NOT NULL DEFAULT 'AADHAR' CHECK (id_type IN ('AADHAR', 'PAN', 'DRIVING_LICENSE', 'PASSPORT')),
  id_number VARCHAR(50) NOT NULL,
  vendor_id UUID REFERENCES vendors(id),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Vehicles ────────────────────────────────────────────────────────────────
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_number VARCHAR(50) NOT NULL,
  vehicle_type VARCHAR(20) NOT NULL DEFAULT 'OTHER' CHECK (vehicle_type IN ('TRUCK', 'VAN', 'TEMPO', 'AUTO', 'CAR', 'BIKE', 'OTHER')),
  vendor_id UUID REFERENCES vendors(id),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Delivery Schedules ──────────────────────────────────────────────────────
CREATE TABLE delivery_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  delivery_number VARCHAR(50) NOT NULL UNIQUE,
  po_id UUID NOT NULL REFERENCES purchase_orders(id),
  po_number VARCHAR(50),
  vendor_id UUID REFERENCES vendors(id),
  vendor_name VARCHAR(255),
  delivery_person_id UUID REFERENCES delivery_persons(id),
  delivery_person_name VARCHAR(255),
  delivery_person_phone VARCHAR(50),
  vehicle_id UUID REFERENCES vehicles(id),
  vehicle_number VARCHAR(50),
  scheduled_date TIMESTAMPTZ NOT NULL,
  slot_start VARCHAR(20),
  slot_end VARCHAR(20),
  delivery_location VARCHAR(255) NOT NULL,
  challan_number VARCHAR(50),
  challan_url TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','PASS_GENERATED','AT_GATE','ENTRY_APPROVED','IN_INSPECTION','PARTIALLY_RECEIVED','FULLY_RECEIVED','EXIT_RECORDED','ENTRY_REJECTED','RESCHEDULED','CANCELLED','EXPIRED')),
  qr_token TEXT,
  qr_token_hash VARCHAR(255),
  backup_code VARCHAR(50),
  backup_code_hash VARCHAR(255),
  pass_valid_from TIMESTAMPTZ,
  pass_valid_until TIMESTAMPTZ,
  pass_usage_count INTEGER NOT NULL DEFAULT 0,
  pass_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ds_po ON delivery_schedules (po_id);
CREATE INDEX idx_ds_status ON delivery_schedules (status);
CREATE INDEX idx_ds_scheduled ON delivery_schedules (scheduled_date);
CREATE INDEX idx_ds_status_scheduled ON delivery_schedules (status, scheduled_date DESC);

-- ─── Delivery Schedule Items ─────────────────────────────────────────────────
CREATE TABLE delivery_schedule_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES delivery_schedules(id) ON DELETE CASCADE,
  product_id VARCHAR(50),
  description VARCHAR(500),
  quantity_expected NUMERIC(10,2),
  unit VARCHAR(50)
);

CREATE INDEX idx_dsi_schedule ON delivery_schedule_items (schedule_id);

-- ─── Delivery Schedule Status History ────────────────────────────────────────
CREATE TABLE delivery_schedule_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES delivery_schedules(id) ON DELETE CASCADE,
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  actor_id VARCHAR(100),
  actor_name VARCHAR(255),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ds_status_history_schedule ON delivery_schedule_status_history (schedule_id);

-- ─── Gate Entries ────────────────────────────────────────────────────────────
CREATE TABLE gate_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  delivery_schedule_id UUID NOT NULL REFERENCES delivery_schedules(id),
  po_id UUID REFERENCES purchase_orders(id),
  po_number VARCHAR(50),
  verification_method VARCHAR(20) NOT NULL CHECK (verification_method IN ('QR', 'MANUAL_CODE')),
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  rejection_reason TEXT,
  security_user_id VARCHAR(100),
  security_user_name VARCHAR(255),
  actual_delivery_person_name VARCHAR(255),
  actual_vehicle_number VARCHAR(50),
  entry_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_time TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ge_schedule ON gate_entries (delivery_schedule_id);
CREATE INDEX idx_ge_entry_time ON gate_entries (entry_time DESC);
CREATE INDEX idx_ge_decision_time ON gate_entries (decision, entry_time DESC);

-- ─── Goods Receipts ──────────────────────────────────────────────────────────
CREATE TABLE goods_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  grn_number VARCHAR(50) NOT NULL UNIQUE,
  po_id UUID NOT NULL REFERENCES purchase_orders(id),
  po_number VARCHAR(50),
  delivery_schedule_id UUID REFERENCES delivery_schedules(id),
  grn_type VARCHAR(20) NOT NULL CHECK (grn_type IN ('PARTIAL', 'FINAL', 'REJECTION', 'RETURN')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FINALIZED')),
  source VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'PO_QR', 'SERVICE_PO')),
  gate_verified_at TIMESTAMPTZ,
  received_by VARCHAR(100),
  received_by_name VARCHAR(255),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  remarks TEXT,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_charge_allocated NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  cumulative_accepted_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  po_grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Receipt evidence (JSONB)
  receipt_evidence JSONB DEFAULT '{}',
  -- Damage evidence (JSONB)
  damage_evidence JSONB DEFAULT '{}',
  -- Service receipt (JSONB)
  service_receipt JSONB DEFAULT '{}',

  document_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_grn_po ON goods_receipts (po_id);
CREATE INDEX idx_grn_type ON goods_receipts (grn_type);
CREATE INDEX idx_grn_status ON goods_receipts (status);
CREATE INDEX idx_grn_type_source_po ON goods_receipts (grn_type, source, po_id);
CREATE INDEX idx_grn_source_received ON goods_receipts (source, received_at DESC);
CREATE INDEX idx_grn_gate_received ON goods_receipts (gate_verified_at, received_at DESC);
CREATE INDEX idx_grn_status_created ON goods_receipts (status, created_at DESC);

-- ─── Goods Receipt Items ─────────────────────────────────────────────────────
CREATE TABLE goods_receipt_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  grn_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  product_id VARCHAR(50),
  po_item_id VARCHAR(100),
  po_item_description VARCHAR(500),
  quantity_ordered NUMERIC(10,2),
  quantity_previously_accepted NUMERIC(10,2) DEFAULT 0,
  quantity_delivered_now NUMERIC(10,2) DEFAULT 0,
  quantity_accepted_now NUMERIC(10,2) DEFAULT 0,
  quantity_damaged NUMERIC(10,2) DEFAULT 0,
  quantity_rejected NUMERIC(10,2) DEFAULT 0,
  quantity_remaining NUMERIC(10,2) DEFAULT 0,
  unit VARCHAR(50),
  unit_price NUMERIC(12,2) DEFAULT 0,
  tax_rate NUMERIC(5,2) DEFAULT 0,
  line_subtotal NUMERIC(12,2) DEFAULT 0,
  discount_allocated NUMERIC(12,2) DEFAULT 0,
  taxable_amount NUMERIC(12,2) DEFAULT 0,
  tax_amount NUMERIC(12,2) DEFAULT 0,
  line_total NUMERIC(12,2) DEFAULT 0,
  serial_numbers JSONB DEFAULT '[]',
  batch_number VARCHAR(100),
  expiry_date TIMESTAMPTZ,
  remarks TEXT
);

CREATE INDEX idx_gri_grn ON goods_receipt_items (grn_id);

-- ─── Audit Logs ──────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  actor_id VARCHAR(100),
  actor_name VARCHAR(255),
  actor_role VARCHAR(50),
  details JSONB,
  ip_address VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_logs (actor_id);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);

-- ─── Email Verifications ─────────────────────────────────────────────────────
CREATE TABLE email_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  purpose VARCHAR(100) NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  session_token_hash VARCHAR(255),
  session_expires_at TIMESTAMPTZ,
  token_used_at TIMESTAMPTZ,
  request_ip VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ev_email ON email_verifications (email);
CREATE INDEX idx_ev_email_purpose ON email_verifications (email, purpose);
CREATE INDEX idx_ev_expires ON email_verifications (expires_at);

-- ─── System Settings ─────────────────────────────────────────────────────────
CREATE TABLE system_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(50) NOT NULL DEFAULT 'global' UNIQUE,
  institutions JSONB DEFAULT '[]',
  college_name VARCHAR(100) DEFAULT 'MSEC',
  college_full_name VARCHAR(255) DEFAULT 'Meenakshi Sundararajan Engineering College',
  email_domain VARCHAR(50) DEFAULT '@msec.edu.in',
  default_department VARCHAR(100) DEFAULT 'MAINTENANCE',
  timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
  currency VARCHAR(10) DEFAULT 'INR',
  allow_public_signup BOOLEAN NOT NULL DEFAULT TRUE,
  enforce_email_domain BOOLEAN NOT NULL DEFAULT TRUE,
  enable_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  enable_email_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  goods_po_geofence_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  service_po_geofence_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  require_issue_photo BOOLEAN NOT NULL DEFAULT FALSE,
  require_completion_photos BOOLEAN NOT NULL DEFAULT TRUE,
  max_attachment_size_mb INTEGER NOT NULL DEFAULT 5 CHECK (max_attachment_size_mb >= 1 AND max_attachment_size_mb <= 25),
  request_edit_window_hours INTEGER NOT NULL DEFAULT 24 CHECK (request_edit_window_hours >= 0 AND request_edit_window_hours <= 168),
  sla_low_hours INTEGER NOT NULL DEFAULT 72 CHECK (sla_low_hours >= 1 AND sla_low_hours <= 720),
  sla_medium_hours INTEGER NOT NULL DEFAULT 48 CHECK (sla_medium_hours >= 1 AND sla_medium_hours <= 720),
  sla_high_hours INTEGER NOT NULL DEFAULT 24 CHECK (sla_high_hours >= 1 AND sla_high_hours <= 720),
  sla_emergency_hours INTEGER NOT NULL DEFAULT 4 CHECK (sla_emergency_hours >= 1 AND sla_emergency_hours <= 720),
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Work Order Updates (for workOrder.updates[] array) ──────────────────────
CREATE TABLE work_order_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  progress_percent INTEGER,
  note TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wou_request ON work_order_updates (request_id);

-- ─── Work Order Materials ────────────────────────────────────────────────────
CREATE TABLE work_order_materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL,
  total_cost NUMERIC(12,2) NOT NULL
);

CREATE INDEX idx_wom_request ON work_order_materials (request_id);

-- ─── Work Order Additional Costs ─────────────────────────────────────────────
CREATE TABLE work_order_additional_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  reason TEXT,
  subtotal NUMERIC(12,2),
  tax_total NUMERIC(12,2),
  grand_total NUMERIC(12,2),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by VARCHAR(255),
  approved_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_woac_request ON work_order_additional_costs (request_id);

-- ─── Quotation Items (for request.quotation.items[]) ─────────────────────────
CREATE TABLE quotation_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('MATERIAL', 'LABOUR', 'SERVICE')),
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL
);

CREATE INDEX idx_qi_request ON quotation_items (request_id);

-- ─── Invoice Items (for request.invoice.items[]) ─────────────────────────────
CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
  line_total NUMERIC(12,2) NOT NULL
);

CREATE INDEX idx_inv_items_request ON invoice_items (request_id);

-- ─── Service Request Payments ────────────────────────────────────────────────
CREATE TABLE service_request_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  payment_number VARCHAR(50) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  method VARCHAR(20) NOT NULL CHECK (method IN ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT_CARD')),
  reference_number VARCHAR(100),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by VARCHAR(255),
  notes TEXT
);

CREATE INDEX idx_srp_request ON service_request_payments (request_id);

-- ─── Purchase Order Expenses (serviceExecution.expenses[]) ───────────────────
CREATE TABLE po_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  category VARCHAR(20) NOT NULL DEFAULT 'OTHER' CHECK (category IN ('LABOUR', 'PARTS', 'TRANSPORT', 'TAX', 'OTHER')),
  description VARCHAR(500) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  bill_name VARCHAR(255),
  bill_url TEXT,
  bill_mimeType VARCHAR(100),
  bill_size INTEGER,
  uploaded_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_poe_po ON po_expenses (po_id);

-- ─── Purchase Order Work Evidence (serviceExecution.workEvidence[]) ───────────
CREATE TABLE po_work_evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  mime_type VARCHAR(100),
  size INTEGER,
  note TEXT,
  uploaded_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_powev_po ON po_work_evidence (po_id);

-- ─── Seed default system settings ────────────────────────────────────────────
INSERT INTO system_settings (key) VALUES ('global') ON CONFLICT (key) DO NOTHING;

export type LeadScore = "HOT" | "WARM" | "COLD";

export type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost";

export type BroadcastStatus = "pending" | "sending" | "completed" | "failed";

export type MessageCategory =
  | "sales"
  | "orders"
  | "payments"
  | "delivery"
  | "general"
  | "complaints"
  | "uncertain";

export type OrderTrack = "stock_on_hand" | "imported";

export interface Lead {
  id: number;
  phone_number: string;
  full_name: string | null;
  email: string | null;
  physical_address: string | null;
  product_interest: string | null;
  recommended_package: string | null;
  household_size: string | null;
  internet_usage: string | null;
  lead_score: LeadScore;
  status: LeadStatus;
  score_locked: boolean;
  status_locked: boolean;
  notes: string | null;
  follow_up_requested: boolean | null;
  follow_up_date: string | null;
  follow_up_sent: boolean | null;
  follow_up_sent_at: string | null;
  offered_package: string | null;
  preferred_contact_number: string | null;
  needs_escalation: boolean | null;
  order_track: OrderTrack | null;
  human_takeover: boolean;
  human_takeover_at: string | null;
  human_takeover_by: string | null;
  last_campaign_contact_date: string | null;
  last_campaign_response: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: number;
  phone_number: string;
  contact_name: string | null;
  incoming_message: string | null;
  ai_response: string | null;
  lead_score: LeadScore;
  session_id: string | null;
  message_id: string | null;
  message_category: MessageCategory | null;
  order_track: OrderTrack | null;
  timestamp: string;
  created_at: string;
}

// conversation_threads view row: the latest message per phone plus the
// total message count, so thread lists don't need every message row.
export interface ConversationThread extends Conversation {
  message_count: number;
}

export interface BroadcastGroup {
  id: number;
  group_name: string;
  group_label: string;
  description: string | null;
  created_at: string;
}

export interface BroadcastContact {
  id: number;
  phone_number: string;
  contact_name: string | null;
  group_id: number | null;
  opt_in: boolean;
  created_at: string;
}

export interface BroadcastHistory {
  id: number;
  campaign_name: string;
  group_id: number | null;
  template_name: string | null;
  message_content: string | null;
  total_sent: number;
  total_delivered: number;
  total_read: number;
  total_failed: number;
  status: BroadcastStatus;
  sent_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Template {
  name: string;
  label: string;
  status: "approved" | "pending" | "rejected" | string;
  language: string;
  category: string;
  body_text: string | null;
  header_text: string | null;
  footer_text: string | null;
}

export interface StaffAlert {
  id: number;
  lead_id: number | null;
  phone_number: string;
  alert_type: string | null;
  email_sent: boolean;
  email_sent_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Campaign Engine types (Phase 1)
// ---------------------------------------------------------------------------

export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "stopped";

export type EnrolmentStatus =
  | "active"
  | "responded"
  | "completed"
  | "removed"
  | "interested"
  | "callback_requested"
  | "not_interested"
  | "opted_out"
  | "no_response_final"
  | "other_invalid";

export type InteractionType = "outbound" | "inbound";

export type DeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export type Classification =
  | "interested"
  | "not_interested"
  | "already_has_service"
  | "needs_information"
  | "no_response"
  | "other"
  | "uncertain"
  | "callback_requested";

export type RejectionReason =
  | "price"
  | "sizing_fit"
  | "delivery_time"
  | "style_design"
  | "competitor"
  | "not_now"
  | "needs_more_info"
  | "not_needed"
  | "other"
  // legacy telecoms reasons — kept for existing rows
  | "already_has_service"
  | "not_eligible";

export type ClassifiedBy = "ai" | "manual";

export interface Campaign {
  id: string;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
  group_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignStep {
  id: string;
  campaign_id: string;
  step_number: number;
  delay_days: number;
  template_name: string;
  template_parameters?: Array<{
    component: string;
    source: "custom" | "contact_name";
    value?: string;
  }> | null;
  created_at: string;
}

export interface CampaignEnrolment {
  id: string;
  campaign_id: string;
  phone_number: string;
  lead_id: number | null;
  current_step: number;
  status: EnrolmentStatus;
  final_outcome: string | null;
  nurture_flag: boolean;
  enrolled_at: string;
  updated_at: string;
}

export interface CampaignInteraction {
  id: string;
  campaign_id: string;
  enrol_id: string | null;
  phone_number: string;
  step_number: number | null;
  message_type: InteractionType;
  template_name: string | null;
  message_body: string | null;
  delivery_status: DeliveryStatus;
  meta_message_id: string | null;
  meta_error: string | null;
  content_type: string | null;
  occurred_at: string;
  created_at: string;
}

export interface CampaignClassification {
  id: string;
  interaction_id: string;
  phone_number: string;
  classification: Classification;
  rejection_reason: RejectionReason | null;
  confidence: number | null;
  classified_by: ClassifiedBy;
  original_ai_classification: Classification | null;
  corrected_by: string | null;
  corrected_at: string | null;
  created_at: string;
}

export interface CampaignAuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  changed_at: string;
}

export interface CampaignError {
  id: string;
  campaign_id: string | null;
  enrol_id: string | null;
  phone_number: string | null;
  error_type: string;
  error_message: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

export interface MessageDeliveryFailure {
  id: string;
  message_id: string | null;
  recipient_phone: string | null;
  error_code: number | null;
  error_title: string | null;
  error_message: string | null;
  raw_status: Record<string, unknown> | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Calling Queue + Opt-out types (Fibre Re-Engagement extension)
// ---------------------------------------------------------------------------

export type QueueStatus = "pending" | "called" | "converted" | "lost" | "callback_scheduled";

export interface CallingQueueItem {
  id: string;
  campaign_id: string | null;
  enrolment_id: string | null;
  phone_number: string;
  lead_id: number | null;
  full_name: string | null;
  email: string | null;
  preferred_package: string | null;
  customer_request: string | null;
  preferred_callback_time: string | null;
  campaign_source: string | null;
  campaign_stage: string | null;
  final_outcome: string | null;
  queue_status: QueueStatus;
  called_at: string | null;
  called_by: string | null;
  call_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OptOutEntry {
  id: string;
  phone_number: string;
  reason: string | null;
  source_campaign_id: string | null;
  opted_out_at: string;
}

// ---- Shopify integration (Eastern Wear M2) ---------------------------------

export interface ShopifyProductRow {
  id: string;
  shopify_product_id: number;
  handle: string | null;
  title: string;
  category: string | null;
  image_url: string | null;
  description: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopifyVariantRow {
  id: string;
  product_id: string;
  shopify_variant_id: number;
  title: string | null;
  sku: string | null;
  price_cents: number | null;
  inventory_qty: number | null;
  inventory_item_id: number | null;
  available: boolean;
  updated_at: string;
}

export interface ShopifyCustomerRow {
  id: string;
  shopify_customer_id: number;
  phone: string | null;
  email: string | null;
  full_name: string | null;
  orders_count: number;
  total_spent_cents: number;
  tags: string[];
  synced_to_broadcast: boolean;
  last_synced_at: string | null;
  created_at: string;
}

export interface ShopifyWebhookEvent {
  id: string;
  topic: string;
  shopify_id: string | null;
  payload: Record<string, unknown>;
  processed: boolean;
  error: string | null;
  received_at: string;
  created_at: string;
}

// ---- Orders (Eastern Wear M3) ----------------------------------------------

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "payment_failed"
  | "cancelled"
  | "expired"
  | "handed_to_orders";

export type DeliveryMethod = "delivery" | "collection";

export interface OrderItem {
  // null for imported-track items — they are not Shopify catalog variants
  variant_id: number | null;
  product_title: string;
  variant_title: string | null;
  sku: string | null;
  qty: number;
  price_cents: number | null;
}

export interface Order {
  id: string;
  order_number: number;
  phone_number: string;
  lead_id: number | null;
  customer_name: string | null;
  customer_email: string | null;
  shopify_draft_order_id: number | null;
  shopify_order_id: number | null;
  shopify_order_number: string | null;
  order_track: OrderTrack;
  items: OrderItem[];
  subtotal_cents: number | null;
  delivery_fee_cents: number;
  total_cents: number | null;
  currency: string;
  delivery_method: DeliveryMethod | null;
  delivery_address: Record<string, unknown> | null;
  payment_link: string | null;
  status: OrderStatus;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  event: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

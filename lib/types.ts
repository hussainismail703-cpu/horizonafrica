export type LeadScore = "HOT" | "WARM" | "COLD";

export type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost";

export type BroadcastStatus = "pending" | "sending" | "completed" | "failed";

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
  notes: string | null;
  follow_up_requested: boolean | null;
  follow_up_date: string | null;
  follow_up_sent: boolean | null;
  follow_up_sent_at: string | null;
  offered_package: string | null;
  needs_escalation: boolean | null;
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
  timestamp: string;
  created_at: string;
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

export type EnrolmentStatus = "active" | "responded" | "completed" | "removed";

export type InteractionType = "outbound" | "inbound";

export type DeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export type Classification =
  | "interested"
  | "not_interested"
  | "already_has_service"
  | "needs_information"
  | "no_response"
  | "other"
  | "uncertain";

export type RejectionReason =
  | "price"
  | "already_has_service"
  | "not_needed"
  | "not_now"
  | "needs_more_info"
  | "competitor"
  | "not_eligible"
  | "other";

export type ClassifiedBy = "ai" | "manual";

export interface Campaign {
  id: string;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignStep {
  id: string;
  campaign_id: string;
  step_number: number;
  delay_days: number;
  template_name: string;
  created_at: string;
}

export interface CampaignEnrolment {
  id: string;
  campaign_id: string;
  phone_number: string;
  lead_id: number | null;
  current_step: number;
  status: EnrolmentStatus;
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

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

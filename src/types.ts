import { z } from 'zod';

// Allowed Enums
export const LanguageSchema = z.enum(['en', 'bn', 'mixed']);
export type Language = z.infer<typeof LanguageSchema>;

export const ChannelSchema = z.enum(['in_app_chat', 'call_center', 'email', 'merchant_portal', 'field_agent']);
export type Channel = z.infer<typeof ChannelSchema>;

export const UserTypeSchema = z.enum(['customer', 'merchant', 'agent', 'unknown']);
export type UserType = z.infer<typeof UserTypeSchema>;

export const TransactionTypeSchema = z.enum(['transfer', 'payment', 'cash_in', 'cash_out', 'settlement', 'refund']);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

export const TransactionStatusSchema = z.enum(['completed', 'failed', 'pending', 'reversed']);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const EvidenceVerdictSchema = z.enum(['consistent', 'inconsistent', 'insufficient_data']);
export type EvidenceVerdict = z.infer<typeof EvidenceVerdictSchema>;

export const CaseTypeSchema = z.enum([
  'wrong_transfer',
  'payment_failed',
  'refund_request',
  'duplicate_payment',
  'merchant_settlement_delay',
  'agent_cash_in_issue',
  'phishing_or_social_engineering',
  'other'
]);
export type CaseType = z.infer<typeof CaseTypeSchema>;

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

export const DepartmentSchema = z.enum([
  'customer_support',
  'dispute_resolution',
  'payments_ops',
  'merchant_operations',
  'agent_operations',
  'fraud_risk'
]);
export type Department = z.infer<typeof DepartmentSchema>;

// Input Schemas
export const TransactionSchema = z.object({
  transaction_id: z.string(),
  timestamp: z.string(), // ISO 8601 string
  type: TransactionTypeSchema,
  amount: z.number(),
  counterparty: z.string(),
  status: TransactionStatusSchema
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const AnalyzeTicketInputSchema = z.object({
  ticket_id: z.string({
    required_error: "ticket_id is required"
  }),
  complaint: z.string({
    required_error: "complaint is required"
  }),
  language: LanguageSchema.optional(),
  channel: ChannelSchema.optional(),
  user_type: UserTypeSchema.optional(),
  campaign_context: z.string().optional(),
  transaction_history: z.array(TransactionSchema).optional(),
  metadata: z.record(z.any()).optional()
});
export type AnalyzeTicketInput = z.infer<typeof AnalyzeTicketInputSchema>;

// Output Schemas
export const AnalyzeTicketOutputSchema = z.object({
  ticket_id: z.string(),
  relevant_transaction_id: z.string().nullable(),
  evidence_verdict: EvidenceVerdictSchema,
  case_type: CaseTypeSchema,
  severity: SeveritySchema,
  department: DepartmentSchema,
  agent_summary: z.string(),
  recommended_next_action: z.string(),
  customer_reply: z.string(),
  human_review_required: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  reason_codes: z.array(z.string()).optional()
});
export type AnalyzeTicketOutput = z.infer<typeof AnalyzeTicketOutputSchema>;

// Schema validation utility for responses to avoid any unexpected output violations
export function validateResponse(data: unknown): AnalyzeTicketOutput {
  return AnalyzeTicketOutputSchema.parse(data);
}

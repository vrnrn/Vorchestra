export const REQUIRED_REPORT_NAMES = [
  'reddit',
  'x',
  'perplexity_finance',
  'tradingview_a',
  'tradingview_b',
  'tradingview_c',
] as const;

export type RequiredReportName = (typeof REQUIRED_REPORT_NAMES)[number];

export type DecisionFailureCode =
  | 'decision_inputs_incomplete'
  | 'decision_provenance_mismatch'
  | 'report_stale'
  | 'decision_authority_invalid'
  | 'report_schema_invalid';

export interface DecisionFailure {
  code: DecisionFailureCode;
  reason: string;
  nextAction: string;
}

export class DecisionValidationError extends Error {
  readonly code: DecisionFailureCode;
  readonly reason: string;
  readonly nextAction: string;

  constructor(failure: DecisionFailure) {
    super(failure.reason);
    this.name = 'DecisionValidationError';
    this.code = failure.code;
    this.reason = failure.reason;
    this.nextAction = failure.nextAction;
  }

  toJSON(): DecisionFailure {
    return {
      code: this.code,
      reason: this.reason,
      nextAction: this.nextAction,
    };
  }
}

export interface ReportProvenance {
  source: string;
  observed_at: string;
  report_hash: string;
}

export interface NamedReport extends ReportProvenance {
  report: Record<string, unknown>;
}

export interface RawReportPolicy {
  source: string;
  observed_at_field: 'asOf' | 'observed_at';
}

export interface ReportBundleInput {
  reports: Record<RequiredReportName, Record<string, unknown>>;
  policy: Record<RequiredReportName, RawReportPolicy>;
}

export interface ReportBundle {
  reports: Record<RequiredReportName, NamedReport>;
}

export interface Signal {
  symbol: string;
  side: 'long' | 'short' | 'flat';
  strength: number;
  confidence: number;
  rationale: string[];
  invalidation: string;
}

export interface ProposedOrder {
  client_order_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'limit';
  quantity: number;
  limit_price: number;
  time_in_force: 'day';
}

export interface DecisionCandidate {
  schema_version: 1;
  run_id: string;
  generated_at: string;
  market_data_as_of: string;
  source_reports: Record<RequiredReportName, ReportProvenance>;
  signals: Signal[];
  proposed_orders: ProposedOrder[];
  conflicts: string[];
  missing_or_stale_sources: string[];
  risk_notes: string[];
  status: 'proposal_only';
  execution_authority: 'none';
  execution_mode: 'paper';
}

export interface DecisionEnvelope {
  candidate: DecisionCandidate;
  reports: Record<RequiredReportName, NamedReport>;
}

export interface WorkflowDecisionEnvelope {
  candidate: DecisionCandidate;
  report_bundle: ReportBundle;
}

export type DecisionEnvelopeInput = DecisionEnvelope | WorkflowDecisionEnvelope;

export interface DecisionPolicy {
  allowedSymbols: readonly string[];
  maxReportAgeMs: number;
  now?: Date | string | number;
}

export interface DecisionWriteOptions extends DecisionPolicy {
  outputPath: string;
}

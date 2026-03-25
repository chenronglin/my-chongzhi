export interface RiskRule {
  id: string;
  ruleCode: string;
  ruleName: string;
  ruleType: string;
  configJson: Record<string, unknown>;
  priority: number;
  status: string;
}

export interface RiskDecision {
  decision: 'PASS' | 'REVIEW' | 'REJECT' | 'DEGRADE';
  reason: string;
  hitRules: string[];
}

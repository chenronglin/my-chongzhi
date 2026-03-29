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
  decision: 'PASS' | 'REJECT';
  reason: string;
  hitRules: string[];
}

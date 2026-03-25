import { generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import { riskSql } from '@/modules/risk/risk.sql';
import type { RiskRule } from '@/modules/risk/risk.types';

export class RiskRepository {
  async listRules(): Promise<RiskRule[]> {
    const rows = await db.unsafe<RiskRule[]>(riskSql.listRules);
    return rows.map((row) => ({
      ...row,
      configJson: parseJsonValue(row.configJson, {}),
    }));
  }

  async createRule(input: {
    ruleCode: string;
    ruleName: string;
    ruleType: string;
    configJson: Record<string, unknown>;
    priority: number;
  }): Promise<RiskRule> {
    const rows = await db<RiskRule[]>`
      INSERT INTO risk.risk_rules (
        id,
        rule_code,
        rule_name,
        rule_type,
        config_json,
        priority,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.ruleCode},
        ${input.ruleName},
        ${input.ruleType},
        ${JSON.stringify(input.configJson)},
        ${input.priority},
        'ACTIVE',
        NOW(),
        NOW()
      )
      RETURNING
        id,
        rule_code AS "ruleCode",
        rule_name AS "ruleName",
        rule_type AS "ruleType",
        config_json AS "configJson",
        priority,
        status
    `;

    const rule = rows[0];

    if (!rule) {
      throw new Error('创建风控规则失败');
    }

    return {
      ...rule,
      configJson: parseJsonValue(rule.configJson, {}),
    };
  }

  async listBlackWhiteEntries(): Promise<
    {
      id: string;
      entryType: string;
      targetValue: string;
      listType: string;
      status: string;
    }[]
  > {
    return db.unsafe(riskSql.listBlackWhite);
  }

  async findBlackWhiteEntry(entryType: string, targetValue: string) {
    return first<{ listType: string; status: string }>(db`
      SELECT
        list_type AS "listType",
        status
      FROM risk.risk_black_white_list
      WHERE entry_type = ${entryType}
        AND target_value = ${targetValue}
        AND status = 'ACTIVE'
      LIMIT 1
    `);
  }

  async addDecision(input: {
    orderNo?: string;
    channelId: string;
    decision: string;
    reason: string;
    hitRules: string[];
  }): Promise<void> {
    await db`
      INSERT INTO risk.risk_decisions (
        id,
        order_no,
        channel_id,
        decision,
        reason,
        hit_rules_json,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.orderNo ?? null},
        ${input.channelId},
        ${input.decision},
        ${input.reason},
        ${JSON.stringify(input.hitRules)},
        NOW()
      )
    `;
  }
}

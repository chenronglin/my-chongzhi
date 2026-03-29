import type { RiskContract } from '@/modules/risk/contracts';
import type { RiskRepository } from '@/modules/risk/risk.repository';

export class RiskService implements RiskContract {
  constructor(private readonly repository: RiskRepository) {}

  async listRules() {
    return this.repository.listRules();
  }

  async createRule(input: {
    ruleCode: string;
    ruleName: string;
    ruleType: string;
    configJson: Record<string, unknown>;
    priority?: number;
  }) {
    return this.repository.createRule({
      ...input,
      priority: input.priority ?? 1,
    });
  }

  async listBlackWhiteEntries() {
    return this.repository.listBlackWhiteEntries();
  }

  async preCheck(input: { channelId: string; orderNo?: string; amount: number; ip?: string }) {
    const hitRules: string[] = [];
    const whiteChannel = await this.repository.findBlackWhiteEntry('CHANNEL', input.channelId);

    if (whiteChannel?.listType === 'WHITE') {
      const decision = {
        decision: 'PASS' as const,
        reason: '命中白名单渠道',
        hitRules: ['WHITE_CHANNEL'],
      };

      await this.repository.addDecision({
        orderNo: input.orderNo,
        channelId: input.channelId,
        decision: decision.decision,
        reason: decision.reason,
        hitRules: decision.hitRules,
      });

      return decision;
    }

    const blackChannel = await this.repository.findBlackWhiteEntry('CHANNEL', input.channelId);

    if (blackChannel?.listType === 'BLACK') {
      const decision = {
        decision: 'REJECT' as const,
        reason: '命中渠道黑名单',
        hitRules: ['BLACK_CHANNEL'],
      };

      await this.repository.addDecision({
        orderNo: input.orderNo,
        channelId: input.channelId,
        decision: decision.decision,
        reason: decision.reason,
        hitRules: decision.hitRules,
      });

      return decision;
    }

    const blackIp = input.ip ? await this.repository.findBlackWhiteEntry('IP', input.ip) : null;

    if (blackIp?.listType === 'BLACK') {
      const decision = {
        decision: 'REJECT' as const,
        reason: '命中 IP 黑名单',
        hitRules: ['BLACK_IP'],
      };

      await this.repository.addDecision({
        orderNo: input.orderNo,
        channelId: input.channelId,
        decision: decision.decision,
        reason: decision.reason,
        hitRules: decision.hitRules,
      });

      return decision;
    }

    const rules = await this.repository.listRules();
    const amountRule = rules.find(
      (rule) => rule.ruleCode === 'AMOUNT_REJECT' && rule.status === 'ACTIVE',
    );

    if (amountRule) {
      const threshold = Number(amountRule.configJson.threshold ?? 0);

      if (input.amount >= threshold) {
        hitRules.push(amountRule.ruleCode);
        const decision = {
          decision: 'REJECT' as const,
          reason: '订单金额触发风控拒绝',
          hitRules,
        };

        await this.repository.addDecision({
          orderNo: input.orderNo,
          channelId: input.channelId,
          decision: decision.decision,
          reason: decision.reason,
          hitRules: decision.hitRules,
        });

        return decision;
      }
    }

    const decision = {
      decision: 'PASS' as const,
      reason: '风控通过',
      hitRules,
    };

    await this.repository.addDecision({
      orderNo: input.orderNo,
      channelId: input.channelId,
      decision: decision.decision,
      reason: decision.reason,
      hitRules: decision.hitRules,
    });

    return decision;
  }
}

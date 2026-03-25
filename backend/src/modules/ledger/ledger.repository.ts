import { generateBusinessNo, generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { ledgerSql } from '@/modules/ledger/ledger.sql';
import type { Account, LedgerEntry, ProfitRule } from '@/modules/ledger/ledger.types';

export class LedgerRepository {
  async listAccounts(): Promise<Account[]> {
    return db.unsafe<Account[]>(ledgerSql.listAccounts);
  }

  async listLedgerEntries(): Promise<LedgerEntry[]> {
    return db.unsafe<LedgerEntry[]>(ledgerSql.listEntries);
  }

  async listProfitRules(): Promise<ProfitRule[]> {
    return db.unsafe<ProfitRule[]>(ledgerSql.listProfitRules);
  }

  async createProfitRule(input: {
    ruleName: string;
    channelId?: string;
    productId?: string;
    skuId?: string;
    configJson: Record<string, unknown>;
  }): Promise<ProfitRule> {
    const rows = await db<ProfitRule[]>`
      INSERT INTO ledger.profit_rules (
        id,
        rule_name,
        channel_id,
        product_id,
        sku_id,
        config_json,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.ruleName},
        ${input.channelId ?? null},
        ${input.productId ?? null},
        ${input.skuId ?? null},
        ${JSON.stringify(input.configJson)},
        'ACTIVE',
        NOW(),
        NOW()
      )
      RETURNING
        id,
        rule_name AS "ruleName",
        channel_id AS "channelId",
        product_id AS "productId",
        sku_id AS "skuId",
        config_json AS "configJson",
        status
    `;

    const rule = rows[0];

    if (!rule) {
      throw new Error('创建分润规则失败');
    }

    return rule;
  }

  async findAccount(ownerType: string, ownerId: string): Promise<Account | null> {
    return first<Account>(db<Account[]>`
      SELECT
        id,
        owner_type AS "ownerType",
        owner_id AS "ownerId",
        available_balance AS "availableBalance",
        frozen_balance AS "frozenBalance",
        currency,
        status
      FROM ledger.accounts
      WHERE owner_type = ${ownerType}
        AND owner_id = ${ownerId}
      LIMIT 1
    `);
  }

  async findPlatformAccount(): Promise<Account | null> {
    return this.findAccount('PLATFORM', 'SYSTEM');
  }

  async findLedgerByReference(
    referenceType: string,
    referenceNo: string,
    actionType: string,
  ): Promise<LedgerEntry | null> {
    return first<LedgerEntry>(db<LedgerEntry[]>`
      SELECT
        id,
        ledger_no AS "ledgerNo",
        account_id AS "accountId",
        order_no AS "orderNo",
        action_type AS "actionType",
        direction,
        amount,
        currency,
        balance_before AS "balanceBefore",
        balance_after AS "balanceAfter",
        reference_type AS "referenceType",
        reference_no AS "referenceNo",
        created_at AS "createdAt"
      FROM ledger.account_ledgers
      WHERE reference_type = ${referenceType}
        AND reference_no = ${referenceNo}
        AND action_type = ${actionType}
      LIMIT 1
    `);
  }

  async transferBalance(input: {
    fromAccountId: string;
    toAccountId: string;
    orderNo: string;
    amount: number;
    referenceNo: string;
    actionType: string;
  }): Promise<void> {
    await db.begin(async (tx) => {
      const fromRows = await tx<Account[]>`
        SELECT
          id,
          owner_type AS "ownerType",
          owner_id AS "ownerId",
          available_balance AS "availableBalance",
          frozen_balance AS "frozenBalance",
          currency,
          status
        FROM ledger.accounts
        WHERE id = ${input.fromAccountId}
        FOR UPDATE
      `;
      const toRows = await tx<Account[]>`
        SELECT
          id,
          owner_type AS "ownerType",
          owner_id AS "ownerId",
          available_balance AS "availableBalance",
          frozen_balance AS "frozenBalance",
          currency,
          status
        FROM ledger.accounts
        WHERE id = ${input.toAccountId}
        FOR UPDATE
      `;

      const fromAccount = fromRows[0];
      const toAccount = toRows[0];

      if (!fromAccount || !toAccount) {
        throw new Error('账户不存在');
      }

      if (Number(fromAccount.availableBalance) < input.amount) {
        throw new Error('账户余额不足');
      }

      const fromAfter = Number(fromAccount.availableBalance) - input.amount;
      const toAfter = Number(toAccount.availableBalance) + input.amount;

      await tx`
        UPDATE ledger.accounts
        SET
          available_balance = ${fromAfter},
          updated_at = NOW()
        WHERE id = ${fromAccount.id}
      `;

      await tx`
        UPDATE ledger.accounts
        SET
          available_balance = ${toAfter},
          updated_at = NOW()
        WHERE id = ${toAccount.id}
      `;

      await tx`
        INSERT INTO ledger.account_ledgers (
          id,
          ledger_no,
          account_id,
          order_no,
          action_type,
          direction,
          amount,
          currency,
          balance_before,
          balance_after,
          reference_type,
          reference_no,
          created_at
        )
        VALUES (
          ${generateId()},
          ${generateBusinessNo('ledger')},
          ${fromAccount.id},
          ${input.orderNo},
          ${input.actionType},
          'DEBIT',
          ${input.amount},
          'CNY',
          ${Number(fromAccount.availableBalance)},
          ${fromAfter},
          'ORDER',
          ${input.referenceNo},
          NOW()
        ),
        (
          ${generateId()},
          ${generateBusinessNo('ledger')},
          ${toAccount.id},
          ${input.orderNo},
          ${input.actionType},
          'CREDIT',
          ${input.amount},
          'CNY',
          ${Number(toAccount.availableBalance)},
          ${toAfter},
          'ORDER',
          ${input.referenceNo},
          NOW()
        )
      `;
    });
  }

  async createSingleLedger(input: {
    accountId: string;
    orderNo: string;
    actionType: string;
    direction: 'DEBIT' | 'CREDIT';
    amount: number;
    referenceType: string;
    referenceNo: string;
  }): Promise<void> {
    await db.begin(async (tx) => {
      const rows = await tx<Account[]>`
        SELECT
          id,
          owner_type AS "ownerType",
          owner_id AS "ownerId",
          available_balance AS "availableBalance",
          frozen_balance AS "frozenBalance",
          currency,
          status
        FROM ledger.accounts
        WHERE id = ${input.accountId}
        FOR UPDATE
      `;
      const account = rows[0];

      if (!account) {
        throw new Error('账户不存在');
      }

      const delta = input.direction === 'CREDIT' ? input.amount : -input.amount;
      const afterBalance = Number(account.availableBalance) + delta;

      await tx`
        UPDATE ledger.accounts
        SET
          available_balance = ${afterBalance},
          updated_at = NOW()
        WHERE id = ${account.id}
      `;

      await tx`
        INSERT INTO ledger.account_ledgers (
          id,
          ledger_no,
          account_id,
          order_no,
          action_type,
          direction,
          amount,
          currency,
          balance_before,
          balance_after,
          reference_type,
          reference_no,
          created_at
        )
        VALUES (
          ${generateId()},
          ${generateBusinessNo('ledger')},
          ${account.id},
          ${input.orderNo},
          ${input.actionType},
          ${input.direction},
          ${input.amount},
          'CNY',
          ${Number(account.availableBalance)},
          ${afterBalance},
          ${input.referenceType},
          ${input.referenceNo},
          NOW()
        )
      `;
    });
  }
}

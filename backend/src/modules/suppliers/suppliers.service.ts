import { badRequest, notFound } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import type { OrderContract } from '@/modules/orders/contracts';
import type { OrderRecord } from '@/modules/orders/orders.types';
import type { SupplierContract } from '@/modules/suppliers/contracts';
import type { SuppliersRepository as Repository } from '@/modules/suppliers/suppliers.repository';
import type {
  SupplierCatalogItem,
  SupplierDynamicItem,
  SupplierReconcileCandidate,
  SupplierReconcileDiff,
} from '@/modules/suppliers/suppliers.types';
import type { WorkerContract } from '@/modules/worker/contracts';

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export class SuppliersService implements SupplierContract {
  constructor(
    private readonly repository: Repository,
    private readonly orderContract: OrderContract,
    private readonly workerContract: WorkerContract,
  ) {}

  async listSuppliers() {
    return this.repository.listSuppliers();
  }

  async createSupplier(input: {
    supplierCode: string;
    supplierName: string;
    protocolType: string;
  }) {
    return this.repository.createSupplier(input);
  }

  async upsertConfig(input: {
    supplierId: string;
    configJson: Record<string, unknown>;
    credential: string;
    callbackSecret: string;
    timeoutMs: number;
  }) {
    await this.repository.upsertConfig(input);
  }

  async syncFullCatalog(input: {
    supplierCode: string;
    items: SupplierCatalogItem[];
  }): Promise<{ syncedProducts: string[] }> {
    const supplier = await this.requireSupplierByCode(input.supplierCode);

    try {
      const syncedProducts: string[] = [];

      for (const item of input.items) {
        const product = await this.repository.upsertRechargeProduct(item);

        await this.repository.upsertProductSupplierMapping({
          productId: product.id,
          supplierId: supplier.id,
          item,
        });

        syncedProducts.push(product.productCode);
      }

      const currentMappings = await this.repository.listMappingsBySupplierId(supplier.id);

      for (const mapping of currentMappings) {
        if (syncedProducts.includes(mapping.productCode)) {
          continue;
        }

        await this.repository.deactivateProductSupplierMapping({
          productId: mapping.productId,
          supplierId: supplier.id,
        });
      }

      await this.repository.addProductSyncLog({
        supplierId: supplier.id,
        syncType: 'FULL',
        status: 'SUCCESS',
        requestPayloadJson: {
          supplierCode: input.supplierCode,
          itemCount: input.items.length,
        },
        responsePayloadJson: {
          syncedProducts,
        },
      });

      return {
        syncedProducts,
      };
    } catch (error) {
      await this.repository.addProductSyncLog({
        supplierId: supplier.id,
        syncType: 'FULL',
        status: 'FAIL',
        requestPayloadJson: {
          supplierCode: input.supplierCode,
          itemCount: input.items.length,
        },
        responsePayloadJson: {},
        errorMessage: error instanceof Error ? error.message : '供应商全量目录同步失败',
      });
      throw error;
    }
  }

  async syncDynamicCatalog(input: {
    supplierCode: string;
    items: SupplierDynamicItem[];
  }): Promise<{ updatedProducts: string[] }> {
    const supplier = await this.requireSupplierByCode(input.supplierCode);

    try {
      const updatedProducts: string[] = [];

      for (const item of input.items) {
        const updated = await this.repository.updateDynamicCatalogItem({
          supplierId: supplier.id,
          item,
        });

        if (updated) {
          updatedProducts.push(updated.productCode);
        }
      }

      await this.repository.addProductSyncLog({
        supplierId: supplier.id,
        syncType: 'DYNAMIC',
        status: 'SUCCESS',
        requestPayloadJson: {
          supplierCode: input.supplierCode,
          itemCount: input.items.length,
        },
        responsePayloadJson: {
          updatedProducts,
        },
      });

      return {
        updatedProducts,
      };
    } catch (error) {
      await this.repository.addProductSyncLog({
        supplierId: supplier.id,
        syncType: 'DYNAMIC',
        status: 'FAIL',
        requestPayloadJson: {
          supplierCode: input.supplierCode,
          itemCount: input.items.length,
        },
        responsePayloadJson: {},
        errorMessage: error instanceof Error ? error.message : '供应商动态目录同步失败',
      });
      throw error;
    }
  }

  async submitOrder(payload: { orderNo: string }) {
    const order = await this.orderContract.getSupplierExecutionContext(payload.orderNo);

    if (
      ['SUCCESS', 'REFUNDED', 'REFUNDING', 'CLOSED'].includes(order.mainStatus) ||
      order.refundStatus === 'PENDING'
    ) {
      return;
    }

    const primarySupplier = this.getPrimarySupplierCandidate(order);
    const existing = await this.repository.findSupplierOrderByOrderNo(payload.orderNo);

    if (existing) {
      return;
    }

    const supplierOrder = await this.repository.createSupplierOrder({
      orderNo: payload.orderNo,
      supplierId: String(primarySupplier.supplierId),
      requestPayloadJson: {
        orderNo: payload.orderNo,
        productId: order.matchedProductId,
      },
      responsePayloadJson: {
        accepted: true,
      },
      standardStatus: 'ACCEPTED',
    });

    await eventBus.publish('SupplierAccepted', {
      orderNo: payload.orderNo,
      supplierId: supplierOrder.supplierId,
      supplierOrderNo: supplierOrder.supplierOrderNo,
      status: 'ACCEPTED',
    });

    await this.workerContract.schedule({
      jobType: 'supplier.query',
      businessKey: `${payload.orderNo}:query`,
      payload: {
        orderNo: payload.orderNo,
        supplierOrderNo: supplierOrder.supplierOrderNo,
        attemptIndex: 0,
      },
      nextRunAt: new Date(Date.now() + 1000),
    });
  }

  async queryOrder(payload: { orderNo: string; supplierOrderNo: string; attemptIndex: number }) {
    const order = await this.orderContract.getSupplierExecutionContext(payload.orderNo);
    const supplierOrder = await this.repository.findSupplierOrderBySupplierOrderNo(
      payload.supplierOrderNo,
    );

    if (!supplierOrder) {
      throw notFound('供应商订单不存在');
    }

    const scenario = String(order.extJson.scenario ?? 'SUCCESS');

    if (scenario === 'SUPPLIER_FAIL') {
      await this.repository.updateSupplierOrderStatus(payload.supplierOrderNo, 'FAIL', {
        result: 'FAIL',
        attemptIndex: payload.attemptIndex,
      });
      await eventBus.publish('SupplierFailed', {
        orderNo: payload.orderNo,
        supplierId: supplierOrder.supplierId,
        supplierOrderNo: payload.supplierOrderNo,
        reason: '模拟供应商履约失败',
      });
      return;
    }

    await this.repository.updateSupplierOrderStatus(payload.supplierOrderNo, 'SUCCESS', {
      result: 'SUCCESS',
      attemptIndex: payload.attemptIndex,
    });
    await eventBus.publish('SupplierSucceeded', {
      orderNo: payload.orderNo,
      supplierId: supplierOrder.supplierId,
      supplierOrderNo: payload.supplierOrderNo,
      costPrice: order.purchasePrice,
    });
  }

  async runInflightReconcile(): Promise<SupplierReconcileDiff[]> {
    return this.collectReconcileDiffs({
      reconcileDate: getTodayDateString(),
      onlyInflight: true,
    });
  }

  async runDailyReconcile(
    input: { reconcileDate?: string } = {},
  ): Promise<SupplierReconcileDiff[]> {
    return this.collectReconcileDiffs({
      reconcileDate: input.reconcileDate ?? getTodayDateString(),
      onlyInflight: false,
    });
  }

  async handleSupplierSubmitJob(payload: Record<string, unknown>) {
    await this.submitOrder({
      orderNo: String(payload.orderNo ?? ''),
    });
  }

  async handleSupplierQueryJob(payload: Record<string, unknown>) {
    await this.queryOrder({
      orderNo: String(payload.orderNo ?? ''),
      supplierOrderNo: String(payload.supplierOrderNo ?? ''),
      attemptIndex: Number(payload.attemptIndex ?? 0),
    });
  }

  async handleSupplierCallback(
    supplierCode: string,
    input: {
      supplierOrderNo: string;
      status: 'SUCCESS' | 'FAIL';
      reason?: string;
    },
  ) {
    const supplier = await this.repository.findSupplierByCode(supplierCode);
    const supplierOrder = await this.repository.findSupplierOrderBySupplierOrderNo(
      input.supplierOrderNo,
    );

    await this.repository.addCallbackLog({
      supplierId: supplier?.id ?? null,
      supplierCode,
      supplierOrderNo: input.supplierOrderNo,
      bodyJson: input,
      parsedStatus: input.status,
      idempotencyKey: `${input.supplierOrderNo}:${input.status}`,
    });

    if (!supplierOrder) {
      throw notFound('供应商订单不存在');
    }

    if (input.status === 'SUCCESS') {
      await this.repository.updateSupplierOrderStatus(input.supplierOrderNo, 'SUCCESS', {
        from: 'callback',
      });
      const order = await this.orderContract.getSupplierExecutionContext(supplierOrder.orderNo);
      await eventBus.publish('SupplierSucceeded', {
        orderNo: supplierOrder.orderNo,
        supplierId: supplierOrder.supplierId,
        supplierOrderNo: input.supplierOrderNo,
        costPrice: order.purchasePrice,
      });
      return;
    }

    await this.repository.updateSupplierOrderStatus(input.supplierOrderNo, 'FAIL', {
      from: 'callback',
      reason: input.reason ?? 'callback fail',
    });
    await eventBus.publish('SupplierFailed', {
      orderNo: supplierOrder.orderNo,
      supplierId: supplierOrder.supplierId,
      supplierOrderNo: input.supplierOrderNo,
      reason: input.reason ?? 'callback fail',
    });
  }

  private async requireSupplierByCode(supplierCode: string) {
    const supplier = await this.repository.findSupplierByCode(supplierCode);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    return supplier;
  }

  private getPrimarySupplierCandidate(order: OrderRecord) {
    const supplierCandidates = (order.supplierRouteSnapshotJson.supplierCandidates ?? []) as Array<
      Record<string, unknown>
    >;
    const primarySupplier = supplierCandidates[0];

    if (!primarySupplier) {
      throw badRequest('订单缺少供应商候选映射');
    }

    return primarySupplier;
  }

  private buildDiffFromCandidate(
    candidate: SupplierReconcileCandidate,
    reconcileDate: string,
    onlyInflight: boolean,
  ): {
    supplierId: string;
    reconcileDate: string;
    orderNo: string;
    diffType: string;
    diffAmount: number;
    detailsJson: Record<string, unknown>;
  } | null {
    if (
      candidate.platformMainStatus === 'REFUNDED' &&
      candidate.supplierOrderStatus === 'SUCCESS'
    ) {
      return {
        supplierId: candidate.supplierId,
        reconcileDate,
        orderNo: candidate.orderNo,
        diffType: 'PLATFORM_REFUNDED_SUPPLIER_SUCCESS',
        diffAmount: candidate.purchasePrice,
        detailsJson: {
          platformMainStatus: candidate.platformMainStatus,
          platformSupplierStatus: candidate.platformSupplierStatus,
          refundStatus: candidate.refundStatus,
          supplierOrderStatus: candidate.supplierOrderStatus,
          supplierOrderNo: candidate.supplierOrderNo,
        },
      };
    }

    if (candidate.platformMainStatus === 'SUCCESS' && candidate.supplierOrderStatus === 'FAIL') {
      return {
        supplierId: candidate.supplierId,
        reconcileDate,
        orderNo: candidate.orderNo,
        diffType: 'PLATFORM_SUCCESS_SUPPLIER_FAIL',
        diffAmount: candidate.purchasePrice,
        detailsJson: {
          platformMainStatus: candidate.platformMainStatus,
          platformSupplierStatus: candidate.platformSupplierStatus,
          refundStatus: candidate.refundStatus,
          supplierOrderStatus: candidate.supplierOrderStatus,
          supplierOrderNo: candidate.supplierOrderNo,
        },
      };
    }

    if (
      onlyInflight &&
      candidate.platformMainStatus === 'PROCESSING' &&
      ['SUCCESS', 'FAIL'].includes(candidate.supplierOrderStatus)
    ) {
      return {
        supplierId: candidate.supplierId,
        reconcileDate,
        orderNo: candidate.orderNo,
        diffType: 'INFLIGHT_STATUS_MISMATCH',
        diffAmount: candidate.purchasePrice,
        detailsJson: {
          platformMainStatus: candidate.platformMainStatus,
          platformSupplierStatus: candidate.platformSupplierStatus,
          refundStatus: candidate.refundStatus,
          supplierOrderStatus: candidate.supplierOrderStatus,
          supplierOrderNo: candidate.supplierOrderNo,
        },
      };
    }

    return null;
  }

  private async collectReconcileDiffs(input: {
    reconcileDate: string;
    onlyInflight: boolean;
  }): Promise<SupplierReconcileDiff[]> {
    const candidates = await this.repository.listReconcileCandidates(input);
    const diffs: SupplierReconcileDiff[] = [];

    for (const candidate of candidates) {
      const builtDiff = this.buildDiffFromCandidate(
        candidate,
        input.reconcileDate,
        input.onlyInflight,
      );

      if (!builtDiff) {
        continue;
      }

      diffs.push(await this.repository.upsertReconcileDiff(builtDiff));
    }

    return diffs;
  }
}

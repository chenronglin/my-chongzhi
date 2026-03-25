import { badRequest, notFound } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import type { OrderContract } from '@/modules/orders/contracts';
import type { SuppliersRepository as Repository } from '@/modules/suppliers/suppliers.repository';
import type { WorkerContract } from '@/modules/worker/contracts';

export class SuppliersService {
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

  async handleSupplierSubmitJob(payload: Record<string, unknown>) {
    const orderNo = String(payload.orderNo ?? '');
    const order = await this.orderContract.getSupplierExecutionContext(orderNo);

    if (['SUCCESS', 'REFUNDED', 'CLOSED'].includes(order.mainStatus)) {
      return;
    }

    const supplierCandidates = (order.supplierRouteSnapshotJson.supplierCandidates ?? []) as Array<
      Record<string, unknown>
    >;
    const primarySupplier = supplierCandidates[0];

    if (!primarySupplier) {
      throw badRequest('订单缺少供应商候选映射');
    }

    const existing = await this.repository.findSupplierOrderByOrderNo(orderNo);

    if (existing) {
      return;
    }

    const supplierOrder = await this.repository.createSupplierOrder({
      orderNo,
      supplierId: String(primarySupplier.supplierId),
      requestPayloadJson: {
        orderNo,
        skuId: order.skuId,
      },
      responsePayloadJson: {
        accepted: true,
      },
      standardStatus: 'ACCEPTED',
    });

    await eventBus.publish('SupplierAccepted', {
      orderNo,
      supplierId: supplierOrder.supplierId,
      supplierOrderNo: supplierOrder.supplierOrderNo,
      status: 'ACCEPTED',
    });

    await this.workerContract.schedule({
      jobType: 'supplier.query',
      businessKey: `${orderNo}:query`,
      payload: {
        orderNo,
        supplierOrderNo: supplierOrder.supplierOrderNo,
      },
      nextRunAt: new Date(Date.now() + 1000),
    });
  }

  async handleSupplierQueryJob(payload: Record<string, unknown>) {
    const orderNo = String(payload.orderNo ?? '');
    const supplierOrderNo = String(payload.supplierOrderNo ?? '');
    const order = await this.orderContract.getSupplierExecutionContext(orderNo);
    const supplierOrder = await this.repository.findSupplierOrderBySupplierOrderNo(supplierOrderNo);

    if (!supplierOrder) {
      throw notFound('供应商订单不存在');
    }

    const scenario = String(order.extJson.scenario ?? 'SUCCESS');

    if (scenario === 'SUPPLIER_FAIL') {
      await this.repository.updateSupplierOrderStatus(supplierOrderNo, 'FAIL', {
        result: 'FAIL',
      });
      await eventBus.publish('SupplierFailed', {
        orderNo,
        supplierId: supplierOrder.supplierId,
        supplierOrderNo,
        reason: '模拟供应商履约失败',
      });
      return;
    }

    await this.repository.updateSupplierOrderStatus(supplierOrderNo, 'SUCCESS', {
      result: 'SUCCESS',
    });
    await eventBus.publish('SupplierSucceeded', {
      orderNo,
      supplierId: supplierOrder.supplierId,
      supplierOrderNo,
      costPrice: order.costPrice,
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
        costPrice: order.costPrice,
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
}

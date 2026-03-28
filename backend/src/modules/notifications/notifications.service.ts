import { badRequest } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import { decryptText, signOpenApiPayload } from '@/lib/security';
import type { NotificationsRepository } from '@/modules/notifications/notifications.repository';
import type {
  NotificationTaskType,
  NotificationTriggerReason,
} from '@/modules/notifications/notifications.types';
import type { OrderContract } from '@/modules/orders/contracts';
import type { WorkerContract } from '@/modules/worker/contracts';

export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly orderContract: OrderContract,
    private readonly workerContract: WorkerContract,
  ) {}

  async listTasks() {
    return this.repository.listTasks();
  }

  async getTask(taskNo: string) {
    return this.repository.findTaskByTaskNo(taskNo);
  }

  async listDeadLetters() {
    return this.repository.listDeadLetters();
  }

  async handleNotificationRequested(input: {
    orderNo: string;
    channelId: string;
    notifyType: 'WEBHOOK' | 'SMS' | 'EMAIL';
    triggerReason: string;
  }) {
    if (input.notifyType !== 'WEBHOOK') {
      throw badRequest('V1 仅支持终态 WEBHOOK 通知');
    }

    if (!['ORDER_SUCCESS', 'REFUND_SUCCEEDED', 'INTERNAL_MANUAL'].includes(input.triggerReason)) {
      throw badRequest('V1 仅支持终态通知触发原因');
    }

    const notifyType: NotificationTaskType = input.notifyType;
    const triggerReason = input.triggerReason as NotificationTriggerReason;

    const order = await this.orderContract.getNotificationContext(input.orderNo);
    const callbackConfig = order.callbackSnapshotJson.callbackConfig as Record<string, unknown>;
    const payload = {
      orderNo: order.orderNo,
      mainStatus: order.mainStatus,
      supplierStatus: order.supplierStatus,
      notifyStatus: order.notifyStatus,
      refundStatus: order.refundStatus,
      triggerReason,
    };
    const destination = String(callbackConfig.callbackUrl ?? 'mock://success');
    const secret = decryptText(String(callbackConfig.secretEncrypted));
    const signature = signOpenApiPayload(secret, JSON.stringify(payload));
    const task = await this.repository.createTask({
      orderNo: order.orderNo,
      channelId: order.channelId,
      notifyType,
      destination,
      payloadJson: payload,
      signature,
    });

    await this.workerContract.enqueue({
      jobType: 'notification.deliver',
      businessKey: task.taskNo,
      payload: {
        taskNo: task.taskNo,
      },
    });
  }

  async handleDeliverJob(payload: Record<string, unknown>) {
    const taskNo = String(payload.taskNo ?? '');
    const task = await this.repository.findTaskByTaskNo(taskNo);

    if (!task) {
      throw new Error('通知任务不存在');
    }

    if (task.status === 'SUCCESS') {
      return;
    }

    await this.repository.markSending(task.taskNo);

    try {
      if (task.destination.startsWith('mock://success')) {
        await this.repository.addDeliveryLog({
          taskNo: task.taskNo,
          requestPayloadJson: task.payloadJson,
          responseStatus: '200',
          responseBody: 'mock success',
          success: true,
        });
        await this.repository.markSuccess(task.taskNo);
        await eventBus.publish('NotificationSucceeded', {
          orderNo: task.orderNo,
          taskNo: task.taskNo,
        });
        return;
      }

      if (task.destination.startsWith('mock://fail')) {
        throw new Error('mock fail');
      }

      const response = await fetch(task.destination, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature': task.signature ?? '',
        },
        body: JSON.stringify(task.payloadJson),
      });
      const responseBody = await response.text();

      await this.repository.addDeliveryLog({
        taskNo: task.taskNo,
        requestPayloadJson: task.payloadJson,
        responseStatus: String(response.status),
        responseBody,
        success: response.ok,
      });

      if (!response.ok) {
        throw new Error(`回调返回非 2xx 状态: ${response.status}`);
      }

      await this.repository.markSuccess(task.taskNo);
      await eventBus.publish('NotificationSucceeded', {
        orderNo: task.orderNo,
        taskNo: task.taskNo,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '通知发送失败';

      if (task.attemptCount + 1 >= task.maxAttempts) {
        await this.repository.markDeadLetter(task.taskNo, message);
        await eventBus.publish('NotificationFailed', {
          orderNo: task.orderNo,
          taskNo: task.taskNo,
          reason: message,
        });
        return;
      }

      await this.repository.markRetry(task.taskNo, message);
      await this.workerContract.schedule({
        jobType: 'notification.deliver',
        businessKey: task.taskNo,
        payload: {
          taskNo: task.taskNo,
        },
        nextRunAt: new Date(Date.now() + 1000),
      });
    }
  }

  async retryTask(taskNo: string) {
    await this.workerContract.schedule({
      jobType: 'notification.deliver',
      businessKey: taskNo,
      payload: {
        taskNo,
      },
      nextRunAt: new Date(),
    });
  }
}

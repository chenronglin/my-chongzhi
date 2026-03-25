# 《渠道服务详细 PRD》

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 文档名称 | 渠道服务详细 PRD |
| 所属系统 | 交易平台后台 API 服务系统 |
| 模块名称 | 渠道服务 / Channel Service |
| 版本 | V1.0 |
| 优先级 | P0 |
| 文档目标 | 明确渠道主体、层级、API Key、授权、价格、限额、白黑名单与回调配置能力 |

## 2. 模块背景与定位

### 2.1 模块背景

平台需要同时服务商户、代理、子代理与企业客户，且不同渠道在商品授权、价格、限额、回调配置上都可能不同。如果没有独立渠道服务，开放平台能力会分散在订单、商品、通知等多个模块中，难以维护。

### 2.2 一句话定位

渠道服务是平台的外部主体与开放能力管理服务，负责渠道主体、分层关系、API Key、授权、渠道价格、限额、白黑名单与回调配置。

### 2.3 模块价值

1. 统一管理外部业务主体。
2. 统一开放 API 签名与身份校验。
3. 统一管理渠道商品授权与价格策略。
4. 统一管理限额、黑白名单与回调配置。

## 3. 职责边界

### 3.1 渠道服务负责什么

1. 渠道主体档案管理。
2. 渠道分层关系管理。
3. API Key / SecretKey 签发、轮换、吊销。
4. 渠道商品授权与渠道价格策略。
5. 渠道限额、配额、白黑名单、IP 控制。
6. 渠道回调地址、回调签名配置管理。

### 3.2 渠道服务不负责什么

1. 不维护后台登录账号体系。
2. 不维护商品全局上下架。
3. 不创建订单与推进订单状态。
4. 不做支付接入、供应商协议与账务记账。
5. 不执行实际通知发送。

### 3.3 与用户与权限服务边界

- 渠道服务管理外部主体。
- 用户与权限服务管理后台账号。
- 若存在渠道门户账号，账号身份归用户与权限服务，渠道档案归渠道服务。

## 4. 设计原则

### 4.1 主体与策略分离原则

渠道主体资料、商品授权、价格策略、限额策略、回调配置需独立建模。

### 4.2 开放能力统一出口原则

所有开放 API 的渠道身份识别与签名校验都应经过渠道服务能力。

### 4.3 分层继承可解释原则

代理、子代理的商品授权、价格策略、限额策略如果支持继承，必须可解释、可追溯、可覆盖。

### 4.4 风险前置原则

IP 白名单、黑白名单、配额、禁用状态要在订单创建前被拦截。

## 5. 模块目标与成功标准

### 5.1 业务目标

- 支撑多种渠道类型接入平台。
- 保证不同渠道看到不同商品、价格和能力范围。
- 在下单前完成身份、限额与禁用校验。

### 5.2 技术目标

- 快速完成签名身份识别。
- 快速返回订单前置策略结果。
- 可审计的 API Key 与策略变更。

### 5.3 成功标准

- 渠道可按层级和类型管理。
- 签名校验稳定可用。
- 订单前可准确得到授权、价格、限额与回调配置。

## 6. 角色与使用场景

| 角色 | 使用场景 |
|---|---|
| 平台渠道运营 | 创建渠道、分配商品、维护价格与限额 |
| 代理 | 管理下级渠道及授权范围 |
| 财务 | 查看渠道结算主体与回款信息 |
| 通知服务 | 读取回调地址与签名配置 |
| 订单服务 | 下单前获取渠道策略快照 |

## 7. 核心对象模型

| 对象 | 说明 |
|---|---|
| Channel | 渠道主体 |
| ChannelHierarchy | 渠道层级关系 |
| ApiCredential | API 凭证 |
| ChannelProductAuthorization | 渠道商品授权 |
| ChannelPricePolicy | 渠道价格策略 |
| ChannelLimitRule | 限额与配额规则 |
| ChannelAccessControl | IP、黑白名单等访问控制 |
| ChannelCallbackConfig | 回调配置 |

关键字段建议：

- `channelId`
- `channelType`
- `parentChannelId`
- `status`
- `settlementSubjectId`
- `accessKey`
- `secretKeyVersion`
- `signAlgorithm`
- `callbackUrl`
- `callbackSignType`

## 8. 状态模型

### 8.1 渠道状态

- `DRAFT`
- `PENDING_REVIEW`
- `ACTIVE`
- `FROZEN`
- `DISABLED`
- `CLOSED`

### 8.2 凭证状态

- `ACTIVE`
- `EXPIRED`
- `REVOKED`

## 9. 核心流程设计

### 9.1 渠道入驻流程

1. 创建渠道主体档案。
2. 建立层级关系。
3. 配置 API Key、授权商品、价格策略、限额与回调配置。
4. 完成审核后激活渠道。

### 9.2 开放 API 身份识别流程

1. API Gateway 解析 `AccessKey`。
2. 渠道服务返回渠道主体、签名算法、密钥版本与状态。
3. 校验签名、时间戳、Nonce、IP 白名单。

### 9.3 下单前策略校验流程

1. 订单服务请求渠道服务。
2. 渠道服务返回授权结果、渠道价、限额结果、回调配置快照。
3. 若不满足条件，返回明确错误原因。

## 10. 功能需求明细

### 10.1 渠道主体管理

- 支持商户、代理、子代理、企业客户等类型。
- 支持基础资料、合同、结算主体信息维护。

### 10.2 渠道层级管理

- 支持父子关系维护。
- 支持查看上下级链路。
- 禁止形成环状依赖。

### 10.3 API 凭证管理

- 支持生成、轮换、吊销、过期控制。
- 支持密钥版本化与签名算法版本管理。

### 10.4 商品授权

- 支持按商品、分类、SKU 粒度授权。
- 支持继承父级授权后按下级覆盖。

### 10.5 渠道价格策略

- 支持按商品或 SKU 配置渠道价。
- 支持生效时间与版本控制。
- 支持与层级价格联动但要可追溯。

### 10.6 限额与白黑名单

- 支持单笔、日、月限额与 QPS 控制。
- 支持 IP 白名单、IP 黑名单、手机号黑名单、主体黑名单。

### 10.7 回调配置

- 支持 Webhook 地址、签名方式、超时阈值、回调开关。
- 支持回调配置快照输出给订单服务。

## 11. 核心规则

1. 禁用或冻结渠道不得继续调用开放 API。
2. API Key 轮换时必须支持版本兼容期。
3. 渠道价格必须与商品标准价分离建模。
4. 回调配置变更不应影响已创建订单，已下单订单使用快照。
5. 渠道继承策略必须能区分“继承值”和“覆盖值”。

## 12. API 设计

### 12.1 后台管理 API

- `GET /admin/channels`
- `POST /admin/channels`
- `PUT /admin/channels/{channelId}`
- `POST /admin/channels/{channelId}/activate`
- `POST /admin/channels/{channelId}/freeze`
- `GET /admin/channel-api-keys`
- `POST /admin/channel-api-keys`
- `POST /admin/channel-api-keys/{credentialId}/rotate`
- `POST /admin/channel-api-keys/{credentialId}/revoke`
- `GET /admin/channel-products`
- `POST /admin/channel-products`
- `GET /admin/channel-prices`
- `POST /admin/channel-prices`
- `GET /admin/channel-limits`
- `POST /admin/channel-limits`
- `GET /admin/channel-callback-configs`
- `POST /admin/channel-callback-configs`

### 12.2 开放平台 API

- `GET /open-api/channel/profile`
- `GET /open-api/channel/quota`
- `GET /open-api/channel/authorized-products`

### 12.3 内部服务 API

- `POST /internal/channels/resolve-access-key`
- `GET /internal/channels/{channelId}/order-policy`
- `GET /internal/channels/{channelId}/callback-config`
- `GET /internal/channels/{channelId}/price-snapshot`

## 13. 数据模型设计

| 表名 | 用途 |
|---|---|
| `channels` | 渠道主体主表 |
| `channel_hierarchy_relations` | 渠道层级关系 |
| `channel_api_credentials` | API 凭证 |
| `channel_product_authorizations` | 商品授权 |
| `channel_price_policies` | 渠道价格策略 |
| `channel_limit_rules` | 限额规则 |
| `channel_access_controls` | 黑白名单与 IP 规则 |
| `channel_callback_configs` | 回调配置 |

## 14. 跨服务协作

### 14.1 与商品服务

- 渠道服务读取标准商品并配置授权范围。

### 14.2 与订单服务

- 订单创建前获取授权、价格、限额、回调配置快照。

### 14.3 与通知服务

- 通知服务读取回调配置进行投递。

### 14.4 与结算与账务服务

- 渠道服务提供结算主体与分层关系参考。

## 15. 异常处理

### 15.1 API Key 失效或吊销

- 拒绝请求。
- 返回明确鉴权错误码。

### 15.2 商品未授权

- 阻断下单。
- 返回渠道授权不足错误。

### 15.3 配额超限

- 阻断请求并记录限额命中日志。

### 15.4 回调配置非法

- 不允许生效。
- 进入待修正状态并告警。

## 16. 权限、审计与非功能要求

### 16.1 权限要求

- 渠道创建、冻结、密钥轮换为高风险操作，需重点审计。

### 16.2 非功能要求

- 身份识别与策略查询接口平均响应小于 150ms。
- 密钥与敏感配置必须加密存储。

## 17. 风险点与控制策略

| 风险 | 影响 | 控制策略 |
|---|---|---|
| 渠道身份混乱 | 鉴权失效 | 统一 API 凭证管理 |
| 价格策略错误 | 账务异常 | 价格版本控制与审计 |
| 配额未前置 | 过载或越权下单 | 下单前统一校验 |
| 回调配置错误 | 通知失败 | 生效校验与快照固化 |

## 18. 验收标准

### 18.1 功能验收

- 可完成渠道创建、激活、冻结、授权、价格、限额、回调配置全流程。
- 可稳定支持开放 API 身份识别与前置策略查询。

### 18.2 数据验收

- 渠道、层级、凭证、授权、价格、限额、回调配置结构完整。

### 18.3 技术验收

- 内部策略查询接口稳定。
- 凭证轮换、吊销、状态校验可生效。

## 19. V1 边界

### 19.1 V1 必做

- 渠道主体管理
- API Key / 签名管理
- 商品授权
- 渠道价格
- 限额与黑白名单
- 回调配置

### 19.2 V1 暂不做

- 复杂可视化渠道策略编排
- 自助式渠道门户配置中心
- 多协议签名插件市场

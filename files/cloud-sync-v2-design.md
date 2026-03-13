# KeyCounter 多设备云同步 v2 设计稿（留档）

> 目标：在保持本地离线可用的前提下，引入账号体系、多设备管理（命名/识别）、多视图展示（总计/单设备），并实现可控成本的“准实时同步”。  
> 策略：**先用 BaaS 快速验证（Hybrid），同时按可迁移到自建后端的方式设计数据模型与接口**。  
> 计划：**Free：单设备 + 云端仅保留最近 90 天**；**Pro：最多 5 台设备 + 不做 90 天保留限制**。

---

## 1. 需求范围与非目标

### 1.1 功能需求
- **账号系统**
  - 注册/登录/登出，会话续期（推荐 JWT + refresh 或直接用 BaaS Auth）。
- **设备系统**
  - 同一账号可绑定多台设备。
  - 每台设备可自定义名称（例：“下班快乐机”“牛马机”）。
  - 设备有稳定 `device_key`（客户端生成并持久化），云端对应 `device_id`。
- **同步**
  - 多设备数据可上传云端并在 Dashboard 展示。
  - 支持准实时：按秒/按分钟刷新都可接受。
  - 支持离线后补传。
- **多视图（Dashboard）**
  - **All devices / 总计视图**：聚合账号下所有设备。
  - **单设备视图**：选择某台设备，仅展示该设备数据。
- **订阅与限制（Free/Pro）**
  - **Free**：仅支持 **1 台设备**；云端仅保留最近 **90 天**数据。
  - **Pro**：最多 **5 台设备**；不执行 90 天数据清理（“无限天数保留”）。

### 1.2 非目标（v2 不做或不承诺）
- 支付系统（可先用“手动切 plan”的方式联调与演示）。
- 每次键鼠事件逐条上传的真实时（v2 用“分桶聚合”替代）。
- 复杂对比分析（设备 A vs B 对比可放 v3）。

---

## 2. 现有系统基线（便于落地对接）

### 2.1 本地数据形态
- `count.ini`：累计与今日汇总。
- `data/YYYYMMDD.ini`：
  - `[Day]`：当日键鼠各项统计
  - `[PerKey]`：按键统计

### 2.2 本地服务与 UI
- 本地 API：`api/index.js`（Express）读取 ini 转 JSON，Dashboard 通过 `/api/data` 展示。
- Dashboard：`ui/`（热力图、Top20 键位、鼠标明细、趋势图）。
- Widget：`widget/`（悬浮窗展示今日键鼠与健康灯）。

---

## 3. 架构总览（Hybrid：先 BaaS，后可迁移）

### 3.1 推荐分层
- **客户端层（本地）**
  - AHK：继续负责采集与写 ini（离线可靠）。
  - 本地 Node API：新增“云代理 + 同步调度”，Dashboard 仍只访问 `localhost:3000`。
- **云端层**
  - 阶段 1：BaaS（Auth + DB + 可选 Realtime/Functions/Cron）。
  - 阶段 2：可迁移到自建（Express + Postgres/MySQL），但保持本地 API 的接口形状不变。

### 3.2 为什么用本地 API 做云代理
- Dashboard 是前端静态页，避免把云端密钥、复杂鉴权逻辑直接放前端。
- 统一把“本地数据/云端数据/合并数据”都封装成同一套本地接口，UI 逻辑最简。

---

## 4. 同步策略（混合：本地事件 → 云端分桶聚合 → 日结）

### 4.1 分桶定义
- 以固定时间窗聚合（推荐 **1 分钟** 或 **5 分钟**）。
- 每个 bucket 记录：
  - 键盘总数增量
  - 鼠标各项增量（左/右/滚轮↑/滚轮↓）
  - perKey 增量（json）

### 4.2 同步节奏
- 本地每 10–30 秒：
  - 从本地“增量缓存”（或当日 ini 差分）归并到当前 bucket
  - 上传云端（upsert 或原子累加）
- Dashboard 刷新：
  - 最小实现：轮询本地 `/api/cloud/data`（例如 2–5 秒）
  - 升级实现：BaaS Realtime 推送“bucket 更新事件”

### 4.3 冲突与去重（v2 推荐做法）
为降低复杂度，推荐 **bucket 覆盖写入**：
- 客户端保证每个 `(device_id, bucket_start)` 只提交一次（使用本地水位 `last_uploaded_bucket_start`）。
- 若需更强鲁棒，可改为“服务端原子自增 + 客户端幂等键”，作为 v3。

---

## 5. 云端数据模型（建议 Postgres/Firestore 等都可映射）

### 5.1 devices（设备表）
- `id` (uuid)
- `user_id`
- `device_key`（稳定设备标识，客户端生成并持久化）
- `display_name`（可编辑）
- `created_at`
- `last_seen_at`
- `disabled_at`（可选，用于 Free 替换设备）

约束：
- `unique(user_id, device_key)`

### 5.2 stats_buckets（分桶聚合表）
- `id` (uuid)
- `user_id`
- `device_id`
- `bucket_start`（timestamp，向下取整到分钟/5 分钟）
- `day_id`（yyyyMMdd，按 StatsBoundaryHour=4 的规则计算）
- `keys_delta`
- `mouse_left_delta`
- `mouse_right_delta`
- `wheel_up_delta`
- `wheel_down_delta`
- `per_key_delta`（jsonb）
- `created_at`, `updated_at`

约束：
- `unique(device_id, bucket_start)`

### 5.3 daily_rollups（可选日结表，提升查询性能）
可在 v2.1 或 v3 再加（先靠查询聚合也能跑）。
- `user_id`
- `device_id`
- `day_id`
- totals（键鼠各项）
- perKey_total（jsonb，可只存 TopN）

### 5.4 user_plans（计划与限制）
- `user_id`
- `plan`：`free` | `pro`
- `device_limit`：free=1, pro=5
- `retention_days`：free=90, pro=NULL（表示不清理）
- `updated_at`

---

## 6. Free/Pro 规则（必须由服务端强制）

### 6.1 Free：单设备
当用户在新设备登录并尝试注册 device 时：
- 若 `active_devices >= 1`：
  - 返回 `device_limit_exceeded`
  - UI 提示：升级 Pro 或“替换当前设备”（如果提供替换按钮）。

替换策略（可选）：
- 将旧设备写入 `disabled_at`，新设备注册成功。

### 6.2 Free：90 天保留
实现方式（推荐定时清理，逻辑集中）：
- 云端 cron/函数每天执行：
  - 对 `plan=free` 的用户，计算 `cutoff_day_id = today_minus_90_days`
  - 删除 `stats_buckets.day_id < cutoff_day_id`（以及对应 `daily_rollups` 若存在）
- Dashboard 展示时提示：Free 仅展示最近 90 天（更早数据可能已被清理）。

### 6.3 Pro：最多 5 台设备 + 不清理
- 设备数限制：`active_devices <= 5`
- `retention_days = NULL`：不执行 90 天清理任务

---

## 7. 本地接口形状（Dashboard 只打 localhost）

> 下面是“本地 API 作为云代理”的建议接口，保持可迁移：未来把 BaaS SDK 调用替换为自建后端调用即可。

### 7.1 认证
- `POST /api/cloud/login`
  - 入参：`{ email, password }` 或 `{ providerToken }`
  - 出参：`{ ok, user, plan, session }`
- `POST /api/cloud/logout`
- `GET /api/cloud/me`
  - 出参：`{ user, plan, deviceLimit, retentionDays }`

### 7.2 设备管理
- `GET /api/cloud/devices`
  - 出参：`{ devices:[{ deviceId, deviceKey, displayName, lastSeenAt, disabled }] }`
- `POST /api/cloud/devices/register`
  - 入参：`{ deviceKey, displayName, clientVersion }`
  - 失败：`device_limit_exceeded`
- `POST /api/cloud/devices/rename`
  - 入参：`{ deviceId, displayName }`

### 7.3 数据同步（分桶）
- `POST /api/cloud/sync/uploadBucket`
  - 入参：`{ deviceId, bucketStart, dayId, deltas:{ keys, mouseLeft, mouseRight, wheelUp, wheelDown, perKeyDelta } }`
  - 服务端处理：upsert 到 `stats_buckets`，并更新 `devices.last_seen_at`

### 7.4 数据查询（支持多视图）
- `GET /api/cloud/data?view=all`
- `GET /api/cloud/data?view=device&deviceId=...`
  - 出参：与现有 `/api/data` 类似，但增加：`viewInfo`、`devices`、`planInfo`
  - 聚合规则：
    - view=all：按 `user_id` 聚合所有设备（可在云端聚合后返回，或在本地 API 聚合）\n+    - view=device：按 `device_id` 过滤后返回

---

## 8. Dashboard UI 改造点（v2）

### 8.1 顶部“视图选择器”
- 默认：`All devices`
- 下拉/标签：列出所有设备别名
- 切换后，全页面图表按 view 重新拉取并渲染：
  - 活动热力图（All/Keys/Mouse）
  - 键位 Top20
  - 鼠标饼图
  - 趋势线（周/月/年）

### 8.2 云同步与账号页面（新增/增强）
- **账户卡片**：显示当前 plan（Free/Pro）、设备上限、数据保留天数（Free=90 天）
- **设备列表**：设备名可编辑；显示最近活跃时间；标记“本机”
- **升级入口**：按钮先占位（v2 可不接支付）
- **错误提示**：
  - `device_limit_exceeded`：提示 Free 仅支持 1 台，升级 Pro 可到 5 台

---

## 9. 迭代里程碑（建议）
- **M1**：云端 Auth + devices + plan（Free/Pro）+ Dashboard 设备列表/重命名（先不做分桶，先上传“按天汇总”也行）\n+- **M2**：分桶上传 + Dashboard 视图选择器（All/单设备）\n+- **M3**：Free 90 天清理任务 + UI 提示\n+- **M4（可选）**：迁移自建后端与数据迁移\n+

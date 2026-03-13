# 开发阶段日志（cloud sync）

> 用途：记录每个主要阶段完成时的关键信息和选择理由，方便你后续回顾和迁移。

## 阶段 0：后端形态与区域性评估

- 时间：2026-03-13
- 主题：选择云端后端（BaaS）并评估在中国大陆的可访问性
- 结论摘要：
  - Supabase 官方目前 **没有中国大陆 Region**，也 **没有明确计划** 支持本地机房。
  - 从国内访问官方 Supabase（托管在国外云上）：
    - 受 GFW 影响，存在 **网络不稳定 / 延迟高 / 偶发连不通** 的风险；
    - 不适合作为「面向国内大量用户」时的主后端，尤其是你希望的是“日常健康工具”，体验要求比较高。
  - 解决思路有三类：
    1. **完全自建**：自己在阿里云/腾讯云等国内机房部署 Postgres + 自建后端（最稳定，但运维成本高）。  
    2. **Supabase 自托管版 + 国内云**：拉取 Supabase 开源版本，在国内服务器运行（需要一定 DevOps 能力，但可以兼得 Postgres + 类似 Supabase API）。  
    3. **继续用 Supabase 官方托管，但仅作为「开发/验证环境」**：用于你本人的开发和少量用户体验，不承诺大规模国内稳定性；未来如果产品要对外正式发布，再迁移到自建/国产云方案。
- 当前决策（v2 开发阶段）：
  - **开发阶段**：仍以 Supabase 官方托管作为「设计原型与接口规范的参考实现」，因为：
    - 文档完善，开发效率高，
    - 可以快速验证数据模型、Free/Pro 规则与多设备逻辑。
  - **上线/扩展阶段**：
    - 需要根据实际目标用户规模，评估是否：
      - 迁移到 **自建后端 + 国内 Postgres/MySQL**，或  
      - 使用 **国内 BaaS / Serverless 平台**（如阿里云函数 + RDS / 腾讯云 SCF + CynosDB 等）。
  - 为了便于将来迁移，所有「云 API」都通过你本地 `api/index.js` 这一层进行封装，前端和 AHK 都不直接依赖 Supabase SDK。

> 后续阶段完成时，请在下方继续追加小节，例如：
> - 阶段 1：Supabase 表结构与 RLS 建完  
> - 阶段 2：本地云代理 API 接好 + 基本登录/设备列表打通  
> - 阶段 3：同步与多视图验收  

## 阶段 1：Supabase 表结构与 RLS 建完

- 时间：2026-03-13
- 内容：
  - 在 Supabase 项目中通过 SQL Editor 执行了 `files/supabase-schema.sql`。
  - 成功创建表：
    - `public.user_plans`
    - `public.devices`
    - `public.stats_buckets`
    - `public.daily_rollups`
  - 为上述表启用了 Row Level Security（RLS），并创建了基于 `auth.uid()` 的策略，保证每个用户只能访问/修改自己的数据。
- 注意：
  - 再次执行同一段 SQL 会出现 “policy ... already exists” 类错误，属于正常现象，表示第一次执行已成功。
  - 之后如果需要修改 schema，建议用「增量 SQL」（alter table / drop policy / create policy），不要整段重跑。

## 阶段 2：本地云代理 API 与 Supabase 连通

- 时间：2026-03-13
- 内容：
  - 在 `api/` 目录安装了依赖：`@supabase/supabase-js`、`dotenv`。
  - 在 `api/index.js` 中：
    - 通过 `require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })` 加载根目录 `.env`。
    - 使用 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 创建了 `supabase`（普通客户端）与 `supabaseAdmin`（带 service_role 的管理客户端）。
    - 新增了辅助函数 `ensureUserPlan(userId)`：首次登录时自动在 `user_plans` 中插入一条 Free 计划（device_limit=1, retention_days=90），后续直接返回已有记录。
  - 新增本地 API 路由：
    - `GET /api/cloud/health`：检查本地是否已正确配置 Supabase（返回 `{ ok: true }` 表示连通）。
    - `POST /api/cloud/login`：邮箱+密码登录 Supabase Auth，成功后在进程内缓存 `currentUser`，并调用 `ensureUserPlan` 确保 `user_plans` 中有一条 Free 记录，返回 `{ ok, user, plan }`。
    - `GET /api/cloud/me`：返回当前进程记住的用户与 plan 信息。
- 验证：
  - 重启 `node api/index.js` 后，在浏览器访问 `http://localhost:3000/api/cloud/health`，得到 `{ "ok": true }`，说明本地 API ↔ Supabase 整条链路连通。
  - 之后可通过 `POST /api/cloud/login` 测试实际登录与 `user_plans` 初始化。

## 阶段 3：本机设备标识与设备注册（初版）

- 时间：2026-03-13
- 内容：
  - 在本地根目录下增加 `device_id.ini` 文件，用于保存当前电脑的稳定 `device_key`：
    - 启动 `api/index.js` 时，如果文件存在则读取；否则生成一个随机 key（`dev_<time>_<random>`）并写入。
  - 在 `api/index.js` 中新增了设备相关的本地状态与 helper：
    - `LOCAL_DEVICE_KEY`：当前机器的 device_key。
    - `currentDevice`：当前登录用户在 Supabase 中对应的这台设备记录。
    - `getActiveDeviceCount(userId)`：查询某用户未禁用设备数量。
    - `registerOrLoadDeviceForCurrentUser(defaultName)`：
      - 先按 `(user_id, device_key)` 在 `devices` 表查询已有记录，若存在直接复用；
      - 若不存在：
        - 调 `ensureUserPlan` 拿到当前用户的 plan（包含 `device_limit`）；
        - 统计活跃设备数量，超出上限时抛出 `device_limit_exceeded`；
        - 否则插入一条新设备记录，`display_name` 使用传入 `defaultName`（例如 \"This Device\"），并设置 `last_seen_at`。
  - 更新 `POST /api/cloud/login` 行为：
    - 登录成功后会：
      - 初始化或读取该用户的 `user_plans` 行（Free 默认：device_limit=1, retention_days=90）。
      - 调用 `registerOrLoadDeviceForCurrentUser`，尝试在 `devices` 表中为当前电脑创建/获取一条记录：
        - 成功时返回 `device` 字段（含 id/deviceKey/displayName/isCurrentDevice）。
        - 若因 Free 设备上限被拒绝，则返回 `device: { error: 'device_limit_exceeded' }`，方便前端做提示。
      - 额外返回 `localDeviceKey`，便于前端区分“本机设备”。
  - 更新 `GET /api/cloud/me`：
    - 除了 `user` 与 `plan`，还会返回 `device` 字段（当前进程记住的设备信息），用于 Dashboard 判断“本机是哪一条设备记录”。

## 阶段 4：设备列表与重命名接口

- 时间：2026-03-13
- 内容：
  - 在 `api/index.js` 中新增设备管理相关路由：
    - `GET /api/cloud/devices`：
      - 要求当前已登录（`currentUser` 存在），否则返回 `401 not_logged_in`。
      - 使用 `supabaseAdmin` 查询 `devices` 表中当前 `user_id` 的全部设备，按 `created_at` 升序排序。
      - 返回结构：`{ ok: true, devices: [...] }`，每个设备包含：
        - `id`、`deviceKey`、`displayName`、`lastSeenAt`、`disabled`；
        - `isCurrentDevice`：通过 `device_key === LOCAL_DEVICE_KEY` 判断是否为“本机”。
    - `POST /api/cloud/devices/rename`：
      - 入参：`{ deviceId, displayName }`。
      - 仅允许修改当前用户（`user_id = currentUser.id`）下的设备。
      - 更新 `devices.display_name` 后返回更新后的设备信息，同样带上 `isCurrentDevice`。
      - 如果修改的是本机设备，会同步更新进程内的 `currentDevice.displayName`。
- 用途：
  - 为 Dashboard 的“云同步/账号页”提供设备列表与改名能力。
  - `isCurrentDevice` 方便前端在列表中标记“本机”。

## 阶段 5：Dashboard Preferences 中的云账号与设备管理 UI（初版）

- 时间：2026-03-13
- 内容：
  - 在 `ui/index.html` 的 Preferences 页（`#page-preferences`）中新增了“云同步 / 账号（实验性）”区域，包括：
    - 邮箱/密码输入框与“登录云账号”按钮；
    - 当前计划信息展示（Free/Pro、设备上限、保留天数）；
    - 设备列表区域（支持重命名），并在文案中提示可以给设备起名如“下班快乐机”“牛马机”。
  - 在 `ui/main.js` 中：
    - 新增了 `cloudState` 及其更新函数 `setCloudState(partial)`，用于在前端缓存当前登录用户、plan、devices、本机 deviceKey。
    - 新增了云相关函数：
      - `fetchCloudMeAndDevices()`：依次调用 `/api/cloud/me` 与 `/api/cloud/devices`，填充 `cloudState`。
      - `renderCloudPrefs()`：根据 `cloudState` 更新 Preferences 中的云账号区域：
        - 未登录：状态显示“未登录”，隐藏计划和设备列表；
        - 已登录：显示邮箱、计划名称（Free/Pro）、设备上限与保留天数说明，并渲染设备列表，每条记录包含名称输入框、“重命名”按钮和本机/禁用标签。
      - `initCloudPrefs()`：绑定“登录云账号”按钮的点击事件：
        - 从表单读取邮箱和密码，调用 `POST /api/cloud/login`；
        - 登录成功后更新 `cloudState`，若返回 `device_limit_exceeded` 则弹窗提示 Free 设备上限；
        - 然后调用 `fetchCloudMeAndDevices()` 并 `renderCloudPrefs()`，同步 UI。
    - 在 `initPrefsForm()` 结束处调用 `initCloudPrefs()`，确保每次进入 Preferences 页都会初始化云账号 UI 并尝试加载当前登录状态。
- 效果：
  - 用户现在可以在 Dashboard → Preferences 中直接输入云端账号密码完成登录。
  - 登录成功后能看到当前计划（Free/Pro）、设备上限、保留天数说明以及当前账号下所有设备列表，并可在前端发起重命名。
  - 后续接入 All devices / 单设备视图时，可直接复用 `cloudState.devices` 与 `isCurrentDevice` 信息。

## 阶段 6：手动上传今日数据（方案 A MVP）

- 时间：2026-03-13
- 目标：
  - 先实现“手动一键上传今日汇总+PerKey”的闭环，让用户能体验云端写入成功，再迭代到自动分桶同步。
- 后端（`api/index.js`）：
  - 新增 `POST /api/cloud/sync/uploadToday`：
    - 要求已登录且已绑定本机设备（`currentUser`、`currentDevice` 存在）。
    - 读取本地当前统计日 `currentDayId`，并优先从 `data/YYYYMMDD.ini` 读取当日 `totals` 与 `perKey`：
      - 若日文件不存在则回退到本地 cache（`/api/data` 构建的数据）。
    - 将当日数据 upsert 写入 Supabase `daily_rollups`（主键：`user_id, device_id, day_id`）。
    - 返回上传结果摘要：keys/mouse 各项与 perKeyCount。
    - 同时更新 `devices.last_seen_at`。
- 前端（`ui/index.html` + `ui/main.js`）：
  - 在 Preferences 的“云同步/账号”区域新增“手动同步”行：
    - 按钮：`上传今日数据`
    - 状态文本：显示上传成功/失败信息。
  - 登录后显示该行（未登录则隐藏）。
  - 点击按钮会调用 `POST /api/cloud/sync/uploadToday`，并在成功后展示本次上传的统计摘要。

## 阶段 7：强制登录门禁 + 记住我（Dashboard 启动即登录）

- 时间：2026-03-13
- 目标：
  - 产品规则调整为“必须登录才能使用”：未登录不展示 Dashboard 内容；后续 AHK 也将据此决定是否启动 widget/统计。
  - 实现“记住我”：重启本地 API / 下次打开 Dashboard 可自动恢复登录态。
- 后端（`api/index.js`）：
  - 新增本地会话文件：`cloud_session.json`（已加入 `.gitignore`，不提交）：
    - 登录成功后保存 `access_token` + `refresh_token` 等信息。
    - 新增 `POST /api/cloud/bootstrap`：启动时尝试读取本地保存的 session，并用 `supabase.auth.setSession` 恢复/刷新登录态；成功后填充 `currentUser/currentPlan/currentDevice`。
    - 新增 `POST /api/cloud/logout`：清理内存登录态并删除 `cloud_session.json`。
  - 权限调整：
    - `POST /api/cloud/sync/uploadToday` 增加 Pro 限制：`plan != 'pro'` 时返回 `403 pro_required`（符合“Free 仅本地存储”规则）。
- 前端（`ui/index.html` + `ui/styles.css` + `ui/main.js`）：
  - 新增全屏登录 Overlay（启动时若未登录则显示）：
    - 页面启动 `init()` 时先调用 `/api/cloud/bootstrap`，再请求 `/api/cloud/me` 判定是否已登录。
    - 未登录：显示 Overlay 并阻止后续 `loadData()/render()`。
    - 登录成功：隐藏 Overlay，继续初始化 Dashboard。
  - 新增 Pro 设备视图按钮行（样式占位）：
    - 在 `#page-dashboard` 中插入 `#deviceViewRow`（CSS grid 6 等分），目前只实现渲染与高亮框架，后续接云端数据切换。

## 阶段 8：AHK 启动登录界面 + 欢迎窗 + 退出入口

- 时间：2026-03-13
- 目标：
  - 用户双击 `key_counter_simple.ahk` 时，先走“登录/自动登录 → 欢迎窗 → 启动统计与悬浮框”的流程，而不是直接开始统计。
  - 未登录时不启动 widget、不注册热键、不写本地统计；关闭登录窗口视为退出程序。
- AHK (`key_counter_simple.ahk`) 主要改动：
  - 新增全局状态：
    - `isLoggedIn := 0`：用于 `#HotIf isLoggedIn` 控制热键是否生效。
    - `loggedInEmail := ""`：记录当前登录用户邮箱，用于欢迎窗文案。
  - 顶部初始化改为调用 `StartUp()`，不再在顶层直接执行 `EnsureDataDir()` / `InitGui()` 等。
  - 新增函数：
    - `StartUp()`：
      - `SetWorkingDir A_ScriptDir`；
      - 调用 `StartApi()` 启动本地 `api/index.js`；
      - 调用 `TryAutoLogin()` 尝试通过 `/api/cloud/bootstrap` + `/api/cloud/me` 自动恢复登录：
        - 若成功：设置 `loggedInEmail`、`isLoggedIn := 1`，显示欢迎窗 `ShowWelcome()`，然后进入 `StartAfterLogin()`；
        - 若失败：弹出登录窗 `ShowLoginGui()`，根据用户操作决定是否继续。
    - `StartApi()`：封装启动/重启本地 API 的逻辑（隐藏运行 `node api/index.js`，记录 `apiPid`）。
    - `TryAutoLogin()`：
      - 使用 COM `WinHttpRequest` 调 `POST /api/cloud/bootstrap`，再 `GET /api/cloud/me`；
      - 若返回 `ok: true` 且提取到邮箱，则视为自动登录成功，设置 `loggedInEmail`、`isLoggedIn`。
    - `ShowLoginGui()`：
      - 创建 AHK GUI 窗口，包含邮箱/密码输入框、登录/退出按钮与提示文本；
      - 登录按钮点击时向 `/api/cloud/login` 发送 JSON 请求；
      - 成功则解析邮箱、设置 `loggedInEmail`、`isLoggedIn := 1`，关闭窗口并返回 true；
      - 失败则在界面上显示错误，不退出程序；
      - 用户点击“退出”或关闭窗口则返回 false，`StartUp()` 随之调用 `ExitApp()` 退出整个程序。
    - `ShowWelcome()`：
      - 使用 AHK GUI 显示一个无边框小窗，内容如“登录成功 / 欢迎 xxx@outlook.com 用户”，居中显示约 3 秒后自动关闭。
    - `CloudHttp(method, path, body := "")`：
      - 用 `WinHttp.WinHttpRequest.5.1` 同步调用本地 API，封装返回 `Status` 与 `Text` 字段。
    - `StartAfterLogin()`：
      - 登录成功后执行原先的初始化逻辑：
        - `EnsureDataDir()`、`CalcDayIdStartup()`、`LoadState()`、`ResetHealthStatusOnStartup()`、`InitGui()`、`SaveState()`、`SaveDaySnapshot()`；
        - 设置托盘菜单项与定时器（`CheckWidgetCommand` / `FlushSave` / `CheckHealthReminders` 等）。
  - 调整热键启用范围：
    - 在鼠标/键盘事件定义前增加 `#HotIf isLoggedIn`，在末尾增加 `#HotIf` 还原；
    - 这样在登录前 `isLoggedIn = 0` 时不会监听键鼠事件，只有登录成功后热键才激活。
- Dashboard 侧补充：
  - 左侧侧边栏增加当前登录用户显示（位于版权信息上方）：
    - 新增 `#sidebarUserInfo` 元素，并在 `renderCloudPrefs()` 中根据 `cloudState.user` + `plan.plan` 填入诸如 `van_wu1@outlook.com · free` 的文案。
  - Preferences 中新增“退出登录”按钮：
    - 点击时调用 `POST /api/cloud/logout`，清空前端 `cloudState` 并调用 `showLoginOverlay(true, ...)` 提示需要重新登录（保留 Dashboard 内部的门禁逻辑作为补充保护）。










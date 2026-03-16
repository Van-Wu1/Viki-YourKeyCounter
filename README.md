# KeyCounter (Viki)

记录每天键盘和鼠标的使用次数，一起预防腱鞘炎！

---

## 📖 说人话版本（小白必看）

> 如果你不太懂技术，按下面步骤一步步来就行。

### 第一步：安装两个软件

1. **AutoHotkey v2**  
   - 打开 [https://www.autohotkey.com/](https://www.autohotkey.com/)  
   - 下载并安装（选 v2 版本）

2. **Node.js**  
   - 打开 [https://nodejs.org/](https://nodejs.org/)  
   - 下载 LTS 版本并安装

### 第二步：下载并配置项目

1. 下载项目（点 GitHub 页面的 **Code** → **Download ZIP**，解压到任意文件夹）
2. 打开命令行（在项目文件夹里按住 Shift 右键 → 选「在此处打开 PowerShell」）
3. 依次输入下面三条命令，每条输完按回车：
   ```
   cd widget
   npm install
   cd ..\api
   npm install
   cd ..\login
   npm install
   ```

### 第三步：登录并启动软件

1. 双击项目里的 `key_counter_simple.ahk`
2. 会先弹出 Electron 登录窗口（使用云账号登录，支持注册、忘记密码）  
   - **Free 用户**：仅支持本地保存最近 90 天的统计，不做云同步  
   - **Pro 用户**：支持多设备 + 云端同步（仍然会在本地保留数据）
3. 登录成功后会短暂显示“欢迎 xxx 用户”的提示窗口，然后：  
   - 右下角托盘出现 KeyCounter 图标  
   - 桌面上出现悬浮框，实时显示今天的按键和鼠标次数（KEYS / MOUSE）

### 第四步：日常使用

| 操作 | 怎么做 |
|------|--------|
| 看详细统计 | 右键托盘图标 → 选 **Open Dashboard** |
| 改设置 | 右键托盘图标 → 选 **Preferences**，或从 Dashboard 左侧点 **Preferences** |
| 隐藏/显示悬浮框 | 右键托盘 → **Hide Window** / **Show Window**，或按 **Ctrl+Alt+H** |
| 云同步（Pro） | Dashboard → **Preferences** → 云同步 → **一键同步**（支持每分钟自动同步） |
| 退出 | 右键托盘 → **Exit**（同时关闭悬浮框与本地 API） |

### 第五步：设置健康提醒（可选）

1. 打开 **Preferences**
2. 可以调整：
   - **久坐提醒（红点）**：连续用电脑多少分钟后提醒（默认 60 分钟，中途休息 ≥3 分钟会重置）
   - **腱鞘炎提醒（黄点）**：每天键盘/鼠标超过多少次要提醒（默认键盘 50000、鼠标 10000，0 表示不限制）
   - **喝水提醒（蓝点）**：每隔多少分钟提醒一次（默认 45 分钟）
3. 点 **保存设置** 生效

悬浮框底部三个灯带对应这三种提醒：亮起表示该提醒已触发。**喝水（蓝）**和**久坐（红/绿）**支持长按 1.5 秒确认：蓝灯亮后长按可熄灭；红灯亮后长按变绿灯（休息中），休息回来长按绿灯可熄灭并重置计时。

---

## 版本日志

### Viki v0.3（当前版本）

- **每键统计**：支持按按键统计使用次数，Dashboard 展示键位排行 Top 20
- **健康提醒**：久坐、腱鞘炎、喝水三合一，仅指示灯无弹窗
- **活动热力图**：类似 GitHub 贡献图，支持 All / Keys / Mouse 切换
- **AutoHotkey v2**：全面迁移至 v2，不再支持 v1
- **启动重置**：重启后健康指示灯从熄灭开始，避免沿用上次状态
- **退出修复**：正确关闭悬浮框进程，避免残留窗口

### 历史版本

- **v0.2**：Dashboard、Preferences、健康提醒（含弹窗）
- **v0.1**：基础键鼠统计、悬浮框、托盘菜单

---

## 技术文档

### 功能概览

- **悬浮框**：实时显示今日 KEYS / MOUSE 统计
- **Dashboard**：活动热力图、键位排行、鼠标明细、趋势图表
- **Preferences**：悬浮框设置（大小、透明度、圆角等）+ 健康提醒配置
- **Ctrl+Alt+H**：快速显隐悬浮框

### 环境要求

- **Windows**
- [AutoHotkey v2](https://www.autohotkey.com/)
- [Node.js](https://nodejs.org/)（LTS 推荐）

### 安装（开发者）

```bash
git clone https://github.com/Van-Wu1/Viki-YourKeyCounter.git
cd Viki-YourKeyCounter

cd widget && npm install && cd ..
cd api && npm install && cd ..
```

### 运行

- 双击 `key_counter_simple.ahk`
- 或右键托盘图标选择对应菜单项

### 托盘菜单说明

| 菜单项 | 说明 |
|--------|------|
| Open Dashboard | 打开统计面板 |
| Preferences | 打开设置页 |
| Show Window / Hide Window | 显隐悬浮框 |
| Update check | 检查更新（待实现） |
| Open source | 打开项目仓库 |
| Reset | 重启程序 |
| Exit | 退出 |

### 项目结构

```
Viki-YourKeyCounter/
├── key_counter_simple.ahk   # 主脚本（统计、托盘、启动 Electron）
├── login/                   # 登录窗口（Electron）
│   ├── main.js
│   ├── login.html
│   └── ...
├── widget/                  # 悬浮框（Electron）
│   ├── main.js
│   ├── widget.html
│   └── ...
├── api/                     # 本地 API 服务
├── ui/                      # Dashboard 页面
├── data/                    # 每日统计（自动生成）
├── count.ini                # 累计数据（自动生成）
├── gui.ini                  # 悬浮框配置（自动生成）
├── health_status.ini        # 健康提醒状态（自动生成）
├── device_id.ini            # 本机设备标识（自动生成，已 .gitignore）
└── cloud_session.json       # 云登录会话（自动生成，已 .gitignore）
```

### 云同步（实验性）

- 项目内置了一个**本地 API + Supabase** 的云同步能力，支持：
  - 账号登录（Auth）
  - 多设备识别与命名
  - 手动上传“当日统计 + PerKey”到云端（写入 `daily_rollups` 表）
- 如果你只是**本地使用 / 不想接云**：
  - 可以在自己的分支中关闭登录门禁逻辑（不启动云相关接口），仅保留本地统计逻辑。
- 如果你想自建云同步：
  - 参考 `files/supabase-schema.sql` 创建表结构；
  - 复制 `.env.sample` 为 `.env`，填写 Supabase 项目地址与密钥：
    - `SUPABASE_URL`
    - `SUPABASE_ANON_KEY`
    - `SUPABASE_SERVICE_ROLE_KEY`
  - 本地 API 会自动加载 `.env` 并启用云端相关接口。

### 打包

如需打包成便携版：

```bash
cd widget
npm run build
```

产物在 `widget/dist/` 目录。

### 作者

[Van_Wu1](https://github.com/Van-Wu1)

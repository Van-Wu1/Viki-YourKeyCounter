# KeyCounter

记录每天键盘和鼠标的使用次数，一起预防腱鞘炎！

## 功能

- **悬浮框**：实时显示今日 KEYS / MOUSE 统计
- **Dashboard**：活动热力图、键位排行、鼠标明细、趋势图表
- **Preferences**：悬浮框设置（大小、透明度、圆角等）
- **Ctrl+Alt+H**：快速显隐悬浮框

## 环境要求

- **Windows**
- [AutoHotkey v1](https://www.autohotkey.com/)
- [Node.js](https://nodejs.org/)（LTS 推荐）

## 安装

1. 克隆仓库：
   ```bash
   git clone https://github.com/Van-Wu1/Viki-YourKeyCounter.git
   cd Viki-YourKeyCounter
   ```

2. 安装依赖：
   ```bash
   cd widget
   npm install
   cd ..
   ```

3. 运行：
   - 双击 `key_counter_simple.ahk`，或右键托盘图标选择菜单项

## 使用

- **Open Dashboard**：打开统计面板
- **Preferences**：打开设置页
- **Show Window / Hide Window**：显隐悬浮框
- **Update check**：检查更新（待实现）
- **Open source**：打开项目仓库
- **Reset**：重启程序
- **Exit**：退出

## 项目结构

```
Viki-YourKeyCounter/
├── key_counter_simple.ahk   # 主脚本（统计、托盘、启动 Electron）
├── widget/                 # 悬浮框（Electron）
│   ├── main.js
│   ├── widget.html
│   └── ...
├── ui/                     # Dashboard 页面
├── data/                   # 每日统计（自动生成）
├── count.ini               # 累计数据（自动生成）
└── gui.ini                 # 悬浮框配置（自动生成）
```

## 打包

如需打包成便携版：

```bash
cd widget
npm run build
```

产物在 `widget/dist/` 目录。

## 作者

[Van_Wu1](https://github.com/Van-Wu1)

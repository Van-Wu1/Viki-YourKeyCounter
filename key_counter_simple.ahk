#NoEnv
#Persistent
#SingleInstance, Force
SetWorkingDir, %A_ScriptDir%

; 版本标识（用于确认是否加载了最新脚本）
scriptVersion = v0.3-perkey
Menu, Tray, Tip, KeyCounter %scriptVersion%

;-------------------------
; 配置
;-------------------------
; 统计日边界：凌晨4点
StatsBoundaryHour = 4

;-------------------------
; 全局变量
;-------------------------
totalKeyboard = 0
totalMouseLeft = 0
totalMouseRight = 0
totalWheelUp = 0
totalWheelDown = 0

todayKeyboard = 0
todayMouseLeft = 0
todayMouseRight = 0
todayWheelUp = 0
todayWheelDown = 0

isGuiShown = 0

currentDayId =
dashboardPid =
apiPid =
needSaveState = 0
lastSittingReminderTime = 0
lastTenosynovitisReminderTime = 0
lastWaterReminderTime = 0
continuousSessionStart = 0

;-------------------------
; 初始化
;-------------------------
Gosub, EnsureDataDir
Gosub, CalcDayIdStartup
Gosub, LoadState
Gosub, InitGui
Gosub, SaveState
Gosub, SaveDaySnapshot

; 托盘菜单
Menu, Tray, NoStandard
Menu, Tray, Add, Open Dashboard, OpenDashboard
SetTimer, CheckWidgetCommand, 500
SetTimer, FlushSave, 2000
SetTimer, CheckHealthReminders, 60000
Menu, Tray, Default, Open Dashboard
Menu, Tray, Add, Preferences, Preferences
Menu, Tray, Add, Show Window, ShowGui
Menu, Tray, Add, Hide Window, HideGui
Menu, Tray, Add
Menu, Tray, Add, Update check, UpdateCheck
Menu, Tray, Add, Open source, OpenSource
Menu, Tray, Add
Menu, Tray, Add, Reset, Reset
Menu, Tray, Add, Exit, ExitAppLabel

;-------------------------
; 悬浮框右键菜单命令（由 widget 写入文件，此处轮询执行）
;-------------------------
CheckWidgetCommand:
    widgetCmdFile = %A_ScriptDir%\keycounter_widget_cmd.txt
    IfNotExist, %widgetCmdFile%
        return
    FileRead, widgetCmd, %widgetCmdFile%
    FileDelete, %widgetCmdFile%
    if (widgetCmd = "OpenDashboard")
        Gosub, OpenDashboard
    else if (widgetCmd = "Preferences")
        Gosub, Preferences
    else if (widgetCmd = "UpdateCheck")
        Gosub, UpdateCheck
    else if (widgetCmd = "OpenSource")
        Gosub, OpenSource
    else if (widgetCmd = "Reset")
        Gosub, Reset
return

;-------------------------
; 鼠标事件
;-------------------------
~LButton::
    lastMouseEvent = MouseLeft
    Gosub, HandleEvent
return

~RButton::
    lastMouseEvent = MouseRight
    Gosub, HandleEvent
return

~WheelUp::
    lastMouseEvent = WheelUp
    Gosub, HandleEvent
return

~WheelDown::
    lastMouseEvent = WheelDown
    Gosub, HandleEvent
return

;-------------------------
; 键盘事件（常见按键 + 标点）
;-------------------------
~*a:: Gosub, HandleKeyEvent
~*b:: Gosub, HandleKeyEvent
~*c:: Gosub, HandleKeyEvent
~*d:: Gosub, HandleKeyEvent
~*e:: Gosub, HandleKeyEvent
~*f:: Gosub, HandleKeyEvent
~*g:: Gosub, HandleKeyEvent
~*h:: Gosub, HandleKeyEvent
~*i:: Gosub, HandleKeyEvent
~*j:: Gosub, HandleKeyEvent
~*k:: Gosub, HandleKeyEvent
~*l:: Gosub, HandleKeyEvent
~*m:: Gosub, HandleKeyEvent
~*n:: Gosub, HandleKeyEvent
~*o:: Gosub, HandleKeyEvent
~*p:: Gosub, HandleKeyEvent
~*q:: Gosub, HandleKeyEvent
~*r:: Gosub, HandleKeyEvent
~*s:: Gosub, HandleKeyEvent
~*t:: Gosub, HandleKeyEvent
~*u:: Gosub, HandleKeyEvent
~*v:: Gosub, HandleKeyEvent
~*w:: Gosub, HandleKeyEvent
~*x:: Gosub, HandleKeyEvent
~*y:: Gosub, HandleKeyEvent
~*z:: Gosub, HandleKeyEvent
~*0:: Gosub, HandleKeyEvent
~*1:: Gosub, HandleKeyEvent
~*2:: Gosub, HandleKeyEvent
~*3:: Gosub, HandleKeyEvent
~*4:: Gosub, HandleKeyEvent
~*5:: Gosub, HandleKeyEvent
~*6:: Gosub, HandleKeyEvent
~*7:: Gosub, HandleKeyEvent
~*8:: Gosub, HandleKeyEvent
~*9:: Gosub, HandleKeyEvent
~*Space:: Gosub, HandleKeyEvent
~*Enter:: Gosub, HandleKeyEvent
~*Backspace:: Gosub, HandleKeyEvent
~*Tab:: Gosub, HandleKeyEvent
~*Delete:: Gosub, HandleKeyEvent
~*Insert:: Gosub, HandleKeyEvent
~*Home:: Gosub, HandleKeyEvent
~*End:: Gosub, HandleKeyEvent
~*PgUp:: Gosub, HandleKeyEvent
~*PgDn:: Gosub, HandleKeyEvent
~*Up:: Gosub, HandleKeyEvent
~*Down:: Gosub, HandleKeyEvent
~*Left:: Gosub, HandleKeyEvent
~*Right:: Gosub, HandleKeyEvent
~*,:: Gosub, HandleKeyEvent
~*.::
    Gosub, HandleKeyEvent
return

; 修饰键与功能键
~*LShift:: Gosub, HandleKeyEvent
~*RShift:: Gosub, HandleKeyEvent
~*LCtrl:: Gosub, HandleKeyEvent
~*RCtrl:: Gosub, HandleKeyEvent
~*LAlt:: Gosub, HandleKeyEvent
~*RAlt:: Gosub, HandleKeyEvent
~*CapsLock:: Gosub, HandleKeyEvent
~*Esc:: Gosub, HandleKeyEvent
~*F1:: Gosub, HandleKeyEvent
~*F2:: Gosub, HandleKeyEvent
~*F3:: Gosub, HandleKeyEvent
~*F4:: Gosub, HandleKeyEvent
~*F5:: Gosub, HandleKeyEvent
~*F6:: Gosub, HandleKeyEvent
~*F7:: Gosub, HandleKeyEvent
~*F8:: Gosub, HandleKeyEvent
~*F9:: Gosub, HandleKeyEvent
~*F10:: Gosub, HandleKeyEvent
~*F11:: Gosub, HandleKeyEvent
~*F12:: Gosub, HandleKeyEvent

;-------------------------
; 事件统一处理
;-------------------------
HandleKeyEvent:
    lastMouseEvent =
    Gosub, NormalizeKeyName
    Gosub, HandleEvent
return

NormalizeKeyName:
    keyName = %A_ThisHotkey%
    StringReplace, keyName, keyName, ~,, All
    StringReplace, keyName, keyName, *,, All
    StringReplace, keyName, keyName, $,, All

    ; 修饰键合并（左右统一）
    if (keyName = "LShift" or keyName = "RShift")
        keyName = Shift
    else if (keyName = "LCtrl" or keyName = "RCtrl")
        keyName = Ctrl
    else if (keyName = "LAlt" or keyName = "RAlt")
        keyName = Alt

    StringLen, keyLen, keyName
    if (keyLen = 1) {
        if (keyName = ",")
        {
            keyName = Comma
        }
        else if (keyName = ".")
        {
            keyName = Period
        }
        else
        {
            StringUpper, keyName, keyName
        }
    }
return

HandleEvent:
    Gosub, CalcDayIdRuntime
    if (newDayId != currentDayId) {
        ; 保存旧日
        Gosub, SaveDaySnapshot
        currentDayId = %newDayId%
        todayKeyboard = 0
        todayMouseLeft = 0
        todayMouseRight = 0
        todayWheelUp = 0
        todayWheelDown = 0
    }

    ; 累加
    if lastMouseEvent =
    {
        ; 键盘事件
        EnvAdd, totalKeyboard, 1
        EnvAdd, todayKeyboard, 1

        ; 每键统计（直接写入当日文件）
        if keyName <>  ; 确保有规范化后的键名
        {
            filePath = data\%currentDayId%.ini
            IniRead, cur, %filePath%, PerKey, %keyName%, 0
            if cur =
                cur = 0
            EnvAdd, cur, 1
            IniWrite, %cur%, %filePath%, PerKey, %keyName%
            IniWrite, %A_Now%, %filePath%, Meta, UpdatedAt
        }
    }
    else
    {
        if lastMouseEvent = MouseLeft
        {
            EnvAdd, totalMouseLeft, 1
            EnvAdd, todayMouseLeft, 1
        }
        else if lastMouseEvent = MouseRight
        {
            EnvAdd, totalMouseRight, 1
            EnvAdd, todayMouseRight, 1
        }
        else if lastMouseEvent = WheelUp
        {
            EnvAdd, totalWheelUp, 1
            EnvAdd, todayWheelUp, 1
        }
        else if lastMouseEvent = WheelDown
        {
            EnvAdd, totalWheelDown, 1
            EnvAdd, todayWheelDown, 1
        }
    }

    Gosub, UpdateGui
    needSaveState = 1
return

FlushSave:
    if (needSaveState = 0)
        return
    needSaveState = 0
    Gosub, SaveState
    Gosub, SaveDaySnapshot
return

;-------------------------
; 健康提醒（三模块：久坐、腱鞘炎、喝水）
;-------------------------
CheckHealthReminders:
    Gosub, CheckSittingReminder
    Gosub, CheckTenosynovitisReminder
    Gosub, CheckWaterReminder
    Gosub, WriteHealthStatus
return

; 久坐提醒：键鼠一直操作 N 分钟，中途无操作少于5分钟则属"一直操作"
CheckSittingReminder:
    IfNotExist, gui.ini
        return
    IniRead, enabled, gui.ini, Preferences, SittingEnabled, 1
    if (enabled != 1)
        return
    IniRead, sittingMins, gui.ini, Preferences, SittingMinutes, 120
    IniRead, cooldownMin, gui.ini, Preferences, ReminderCooldown, 1
    sittingMins := sittingMins + 0
    cooldownMin := cooldownMin + 0
    now := A_Now
    idleMs := A_TimeIdlePhysical
    idleMins := idleMs / 60000
    if (idleMins >= 5) {
        ; 超过5分钟无操作，视为休息，重置连续操作起点
        continuousSessionStart := now
        IniWrite, 0, health_status.ini, Status, Sitting
        return
    }
    if (continuousSessionStart = 0)
        continuousSessionStart := now
    diffMins := now
    EnvSub, diffMins, %continuousSessionStart%, Minutes
    if (diffMins < sittingMins) {
        IniWrite, 0, health_status.ini, Status, Sitting
        return
    }
    diffCooldown := now
    EnvSub, diffCooldown, %lastSittingReminderTime%, Minutes
    if (lastSittingReminderTime > 0 && diffCooldown < cooldownMin)
        return
    lastSittingReminderTime := now
    continuousSessionStart := now
    IniWrite, 1, health_status.ini, Status, Sitting
return

; 腱鞘炎提醒：当日键盘/鼠标超过阈值
CheckTenosynovitisReminder:
    IfNotExist, gui.ini
        return
    IniRead, enabled, gui.ini, Preferences, TenosynovitisEnabled, %A_Space%
    if (enabled = "")
        IniRead, enabled, gui.ini, Preferences, ReminderEnabled, 1
    if (enabled != 1)
        return
    IniRead, kbThreshold, gui.ini, Preferences, KeyboardThreshold, 50000
    IniRead, mouseThreshold, gui.ini, Preferences, MouseThreshold, 10000
    IniRead, cooldownMin, gui.ini, Preferences, ReminderCooldown, 1
    kbThreshold := kbThreshold + 0
    mouseThreshold := mouseThreshold + 0
    cooldownMin := cooldownMin + 0
    if (kbThreshold <= 0 && mouseThreshold <= 0) {
        IniWrite, 0, health_status.ini, Status, Tenosynovitis
        return
    }
    todayMouse := todayMouseLeft + todayMouseRight + todayWheelUp + todayWheelDown
    exceeded := 0
    if (kbThreshold > 0 && todayKeyboard >= kbThreshold)
        exceeded := 1
    if (mouseThreshold > 0 && todayMouse >= mouseThreshold)
        exceeded := 1
    if (exceeded = 0) {
        IniWrite, 0, health_status.ini, Status, Tenosynovitis
        return
    }
    now := A_Now
    diffMins := now
    EnvSub, diffMins, %lastTenosynovitisReminderTime%, Minutes
    if (lastTenosynovitisReminderTime > 0 && diffMins < cooldownMin)
        return
    lastTenosynovitisReminderTime := now
    IniWrite, 1, health_status.ini, Status, Tenosynovitis
    TrayTip, KeyCounter 腱鞘炎提醒, 今日使用量已达阈值，建议休息片刻，预防腱鞘炎。, 10, 1
return

; 喝水提醒：每隔 N 分钟定时提醒
CheckWaterReminder:
    IfNotExist, gui.ini
        return
    IniRead, enabled, gui.ini, Preferences, WaterEnabled, 1
    if (enabled != 1)
        return
    IniRead, waterMins, gui.ini, Preferences, WaterMinutes, 45
    IniRead, cooldownMin, gui.ini, Preferences, ReminderCooldown, 1
    waterMins := waterMins + 0
    cooldownMin := cooldownMin + 0
    now := A_Now
    if (lastWaterReminderTime = 0) {
        lastWaterReminderTime := now
        IniWrite, 0, health_status.ini, Status, Water
        return
    }
    diffMins := now
    EnvSub, diffMins, %lastWaterReminderTime%, Minutes
    if (diffMins < waterMins) {
        IniWrite, 0, health_status.ini, Status, Water
        return
    }
    diffCooldown := now
    EnvSub, diffCooldown, %lastWaterReminderTime%, Minutes
    if (diffCooldown < cooldownMin)
        return
    lastWaterReminderTime := now
    IniWrite, 1, health_status.ini, Status, Water
return

; 统一写入 health_status.ini（冷却结束后写回 0 由各模块负责）
WriteHealthStatus:
    IfNotExist, health_status.ini
    {
        IniWrite, 0, health_status.ini, Status, Sitting
        IniWrite, 0, health_status.ini, Status, Tenosynovitis
        IniWrite, 0, health_status.ini, Status, Water
    }
return

;-------------------------
; GUI：悬浮框 - Electron Widget（读写 gui.ini 与 count.ini）
;-------------------------
InitGui:
    IniWrite, 1, gui.ini, Floating, Visible
    widgetDir = %A_ScriptDir%\widget
    electronExe = %widgetDir%\node_modules\electron\dist\electron.exe
    if (FileExist(electronExe)) {
        batchPath = %A_Temp%\keycounter_launch.bat
        FileDelete, %batchPath%
        FileAppend, @echo off`ncd /d "%widgetDir%"`nstart "" "%electronExe%" "."`n, %batchPath%
        Run, "%batchPath%", %A_Temp%, Hide
    } else {
        Run, npx electron ., %widgetDir%, Hide
    }
    isGuiShown = 1
return

UpdateGui:
    ; 数值由 widget 从 count.ini 读取，此处无需更新
return

ShowGui:
    IniWrite, 1, gui.ini, Floating, Visible
    isGuiShown = 1
return

HideGui:
    IniWrite, 0, gui.ini, Floating, Visible
    isGuiShown = 0
return

; Ctrl+Alt+H 显隐（读写 gui.ini，由 widget 轮询）
^!h::
    if (isGuiShown) {
        IniWrite, 0, gui.ini, Floating, Visible
        isGuiShown = 0
    } else {
        IniWrite, 1, gui.ini, Floating, Visible
        isGuiShown = 1
    }
return

;-------------------------
; GUI：看板 (Gui 2) - WebBrowser 嵌入 ui/index.html
;-------------------------
OpenDashboard:
    dashboardHash =
    Gosub, OpenDashboardCore
return

OpenDashboardToPrefs:
    dashboardHash = #preferences
    Gosub, OpenDashboardCore
return

OpenDashboardCore:
    SetWorkingDir, %A_ScriptDir%
    ; 先终止旧 API，确保加载最新代码
    if (apiPid)
    {
        Process, Close, %apiPid%
        apiPid =
        Sleep, 500
    }
    ; 不设置 KEYCOUNTER_ROOT，避免中文路径编码问题；API 使用 __dirname 解析路径
    apiScript = %A_ScriptDir%\api\index.js
    Run, node "%apiScript%", %A_ScriptDir%, Hide, apiPid
    Sleep, 2000

    edgePath = %A_ProgramFiles%\Microsoft\Edge\Application\msedge.exe
    edgeExists := FileExist(edgePath)
    if (!edgeExists)
    {
        edgePathX86 = C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
        if (FileExist(edgePathX86))
        {
            edgePath = %edgePathX86%
            edgeExists = 1
        }
    }
    dashboardUrl = http://localhost:3000/%dashboardHash%
    if (edgeExists)
        Run, "%edgePath%" --app="%dashboardUrl%" --window-size=900`,600, , , dashboardPid
    else
        Run, "%dashboardUrl%", , , dashboardPid
return

;-------------------------
; 存储
;-------------------------
EnsureDataDir:
    FileCreateDir, data
return

LoadState:
    IfNotExist, count.ini
        return

    IniRead, savedDayId, count.ini, Meta, DayId, %currentDayId%
    IniRead, totalKeyboard,   count.ini, Total, Keyboard, 0
    IniRead, totalMouseLeft,  count.ini, Total, MouseLeft, 0
    IniRead, totalMouseRight, count.ini, Total, MouseRight, 0
    IniRead, totalWheelUp,    count.ini, Total, WheelUp, 0
    IniRead, totalWheelDown,  count.ini, Total, WheelDown, 0

    if (savedDayId = currentDayId) {
        IniRead, todayKeyboard,   count.ini, Today, Keyboard, 0
        IniRead, todayMouseLeft,  count.ini, Today, MouseLeft, 0
        IniRead, todayMouseRight, count.ini, Today, MouseRight, 0
        IniRead, todayWheelUp,    count.ini, Today, WheelUp, 0
        IniRead, todayWheelDown,  count.ini, Today, WheelDown, 0
    }
    else
    {
        todayKeyboard = 0
        todayMouseLeft = 0
        todayMouseRight = 0
        todayWheelUp = 0
        todayWheelDown = 0
    }
return

SaveState:
    IniWrite, %currentDayId%, count.ini, Meta, DayId

    IniWrite, %totalKeyboard%,   count.ini, Total, Keyboard
    IniWrite, %totalMouseLeft%,  count.ini, Total, MouseLeft
    IniWrite, %totalMouseRight%, count.ini, Total, MouseRight
    IniWrite, %totalWheelUp%,    count.ini, Total, WheelUp
    IniWrite, %totalWheelDown%,  count.ini, Total, WheelDown

    IniWrite, %todayKeyboard%,   count.ini, Today, Keyboard
    IniWrite, %todayMouseLeft%,  count.ini, Today, MouseLeft
    IniWrite, %todayMouseRight%, count.ini, Today, MouseRight
    IniWrite, %todayWheelUp%,    count.ini, Today, WheelUp
    IniWrite, %todayWheelDown%,  count.ini, Today, WheelDown
return

SaveDaySnapshot:
    if currentDayId =
        return
    filePath = data\%currentDayId%.ini

    IniWrite, %currentDayId%, %filePath%, Meta, DayId
    IniWrite, %A_Now%,        %filePath%, Meta, UpdatedAt

    IniWrite, %todayKeyboard%,   %filePath%, Day, Keyboard
    IniWrite, %todayMouseLeft%,  %filePath%, Day, MouseLeft
    IniWrite, %todayMouseRight%, %filePath%, Day, MouseRight
    IniWrite, %todayWheelUp%,    %filePath%, Day, WheelUp
    IniWrite, %todayWheelDown%,  %filePath%, Day, WheelDown
return

;-------------------------
; 日界线计算（启动时）
;-------------------------
CalcDayIdStartup:
    now = %A_Now%
    FormatTime, hour, %now%, HH
    if (hour >= StatsBoundaryHour) {
        FormatTime, currentDayId, %now%, yyyyMMdd
        return
    }
    shifted = %now%
    EnvAdd, shifted, -1, Days
    FormatTime, currentDayId, %shifted%, yyyyMMdd
return

;-------------------------
; 日界线计算（事件时）
;-------------------------
CalcDayIdRuntime:
    now = %A_Now%
    FormatTime, hour, %now%, HH
    if (hour >= StatsBoundaryHour) {
        FormatTime, newDayId, %now%, yyyyMMdd
        return
    }
    shifted = %now%
    EnvAdd, shifted, -1, Days
    FormatTime, newDayId, %shifted%, yyyyMMdd
return

;-------------------------
; 托盘菜单动作
;-------------------------
Preferences:
    Gosub, OpenDashboardToPrefs
    return

UpdateCheck:
    ; 检查更新（待实现，后续维护在 GitHub）
return

OpenSource:
    Run, https://github.com/Van-Wu1/Viki-YourKeyCounter
return

Reset:
    SetTimer, CheckWidgetCommand, Off
    SetTimer, FlushSave, Off
    SetTimer, CheckHealthReminders, Off
    if (needSaveState)
        Gosub, FlushSave
    if (apiPid)
    {
        Process, Close, %apiPid%
        apiPid =
    }
    if (dashboardPid)
    {
        Process, Close, %dashboardPid%
        dashboardPid =
    }
    WinClose, KeyCounter Dashboard
    WinClose, KeyCounter Widget
    Reload

ExitAppLabel:
    SetTimer, CheckWidgetCommand, Off
    SetTimer, FlushSave, Off
    SetTimer, CheckHealthReminders, Off
    if (needSaveState)
        Gosub, FlushSave
    if (apiPid)
    {
        Process, Close, %apiPid%
        apiPid =
    }
    if (dashboardPid)
    {
        Process, Close, %dashboardPid%
        dashboardPid =
    }
    WinClose, KeyCounter Dashboard
    WinClose, KeyCounter Widget
    ExitApp


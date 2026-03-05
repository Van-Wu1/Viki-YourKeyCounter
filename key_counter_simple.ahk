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
dashboardTempBase =
needSaveState = 0

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
    tempBase = %A_Temp%\keycounter_dashboard
    FileRemoveDir, %tempBase%, 1
    FileCreateDir, %tempBase%
    FileCopy, %A_ScriptDir%\ui\index.html, %tempBase%\index.html, 1
    FileCopy, %A_ScriptDir%\ui\styles.css, %tempBase%\styles.css, 1
    FileCopy, %A_ScriptDir%\ui\main.js, %tempBase%\main.js, 1
    if (FileExist(A_ScriptDir . "\public\moneycome.jpg"))
        FileCopy, %A_ScriptDir%\public\moneycome.jpg, %tempBase%\moneycome.jpg, 1

    ; 生成 data.js（内联，避免 Gosub 标签解析问题）
    dataPath = %tempBase%\data.js
    IniRead, metaDayId, %A_ScriptDir%\count.ini, Meta, DayId,
    IniRead, totKb, %A_ScriptDir%\count.ini, Total, Keyboard, 0
    IniRead, totML, %A_ScriptDir%\count.ini, Total, MouseLeft, 0
    IniRead, totMR, %A_ScriptDir%\count.ini, Total, MouseRight, 0
    IniRead, totWU, %A_ScriptDir%\count.ini, Total, WheelUp, 0
    IniRead, totWD, %A_ScriptDir%\count.ini, Total, WheelDown, 0
    daysArr =
    dayData =
    Loop, %A_ScriptDir%\data\*.ini, 0
    {
        fname := A_LoopFileName
        StringReplace, dayId, fname, .ini,, All
        if daysArr =
            daysArr = "%dayId%"
        else
            daysArr = %daysArr%,"%dayId%"
        IniRead, kb, %A_ScriptDir%\data\%dayId%.ini, Day, Keyboard, 0
        IniRead, ml, %A_ScriptDir%\data\%dayId%.ini, Day, MouseLeft, 0
        IniRead, mr, %A_ScriptDir%\data\%dayId%.ini, Day, MouseRight, 0
        IniRead, wu, %A_ScriptDir%\data\%dayId%.ini, Day, WheelUp, 0
        IniRead, wd, %A_ScriptDir%\data\%dayId%.ini, Day, WheelDown, 0
        perKeyJson =
        inPerKey = 0
        Loop, Read, %A_ScriptDir%\data\%dayId%.ini
        {
            line := A_LoopReadLine
            if (SubStr(line, 1, 1) = "[")
            {
                inPerKey = 0
                if (line = "[PerKey]")
                    inPerKey = 1
                continue
            }
            if (inPerKey = 1) and InStr(line, "=")
            {
                pos := InStr(line, "=")
                key := SubStr(line, 1, pos - 1)
                val := SubStr(line, pos + 1)
                if perKeyJson =
                    perKeyJson = "%key%":%val%
                else
                    perKeyJson = %perKeyJson%,"%key%":%val%
            }
        }
        dayObj = {"totals":{"keyboard":%kb%,"mouseLeft":%ml%,"mouseRight":%mr%,"wheelUp":%wu%,"wheelDown":%wd%},"perKey":{%perKeyJson%}}
        if dayData =
            dayData = "%dayId%":%dayObj%
        else
            dayData = %dayData%,"%dayId%":%dayObj%
    }
    if daysArr =
        daysArr = []
    else
        daysArr = [%daysArr%]
    if dayData =
        dayData = {}
    else
        dayData = {%dayData%}
    ; 读取 gui.ini 供 Preferences 使用
    IniRead, guiX, %A_ScriptDir%\gui.ini, Floating, X, 0
    IniRead, guiY, %A_ScriptDir%\gui.ini, Floating, Y, 0
    IniRead, guiVis, %A_ScriptDir%\gui.ini, Floating, Visible, 1
    IniRead, prefW, %A_ScriptDir%\gui.ini, Preferences, Width, 160
    IniRead, prefH, %A_ScriptDir%\gui.ini, Preferences, Height, 70
    IniRead, prefT, %A_ScriptDir%\gui.ini, Preferences, Transparency, 94
    IniRead, prefB, %A_ScriptDir%\gui.ini, Preferences, BorderRadius, 14
    guiIniJson = {"Floating":{"X":"%guiX%","Y":"%guiY%","Visible":"%guiVis%"},"Preferences":{"Width":"%prefW%","Height":"%prefH%","Transparency":"%prefT%","BorderRadius":"%prefB%"}}
    jsContent = window.__KEYCOUNTER_DATA__={"currentDayId":"%metaDayId%","totals":{"keyboard":%totKb%,"mouseLeft":%totML%,"mouseRight":%totMR%,"wheelUp":%totWU%,"wheelDown":%totWD%},"days":%daysArr%,"dayData":%dayData%};window.__KEYCOUNTER_GUI_INI__=%guiIniJson%;
    ; 先写入脚本目录再复制，避免 temp 路径写入失败；内联易导致 </script> 破坏 HTML
    dataJsLocal = %A_ScriptDir%\data_dashboard.js
    FileDelete, %dataJsLocal%
    FileAppend, %jsContent%, %dataJsLocal%
    FileCopy, %dataJsLocal%, %tempBase%\data.js, 1
    FileDelete, %dataJsLocal%

    ; 使用 Edge --app 模式打开（Chromium 渲染，支持现代 JS/CSS）
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
    dashboardTempBase = %tempBase%
    if (edgeExists)
        Run, "%edgePath%" --app="%tempBase%\index.html%dashboardHash%" --window-size=900`,600, , , dashboardPid
    else
        Run, "%tempBase%\index.html%dashboardHash%", , , dashboardPid
    SetTimer, RegenerateDashboardData, 5000
return

RegenerateDashboardData:
    if (dashboardTempBase = "")
        return
    if (!FileExist(dashboardTempBase))
        return
    Gosub, RegenerateDashboardDataCore
return

RegenerateDashboardDataCore:
    SetWorkingDir, %A_ScriptDir%
    tempBase = %dashboardTempBase%
    dataPath = %tempBase%\data.js
    IniRead, metaDayId, %A_ScriptDir%\count.ini, Meta, DayId,
    IniRead, totKb, %A_ScriptDir%\count.ini, Total, Keyboard, 0
    IniRead, totML, %A_ScriptDir%\count.ini, Total, MouseLeft, 0
    IniRead, totMR, %A_ScriptDir%\count.ini, Total, MouseRight, 0
    IniRead, totWU, %A_ScriptDir%\count.ini, Total, WheelUp, 0
    IniRead, totWD, %A_ScriptDir%\count.ini, Total, WheelDown, 0
    daysArr =
    dayData =
    Loop, %A_ScriptDir%\data\*.ini, 0
    {
        fname := A_LoopFileName
        StringReplace, dayId, fname, .ini,, All
        if daysArr =
            daysArr = "%dayId%"
        else
            daysArr = %daysArr%,"%dayId%"
        IniRead, kb, %A_ScriptDir%\data\%dayId%.ini, Day, Keyboard, 0
        IniRead, ml, %A_ScriptDir%\data\%dayId%.ini, Day, MouseLeft, 0
        IniRead, mr, %A_ScriptDir%\data\%dayId%.ini, Day, MouseRight, 0
        IniRead, wu, %A_ScriptDir%\data\%dayId%.ini, Day, WheelUp, 0
        IniRead, wd, %A_ScriptDir%\data\%dayId%.ini, Day, WheelDown, 0
        perKeyJson =
        inPerKey = 0
        Loop, Read, %A_ScriptDir%\data\%dayId%.ini
        {
            line := A_LoopReadLine
            if (SubStr(line, 1, 1) = "[")
            {
                inPerKey = 0
                if (line = "[PerKey]")
                    inPerKey = 1
                continue
            }
            if (inPerKey = 1) and InStr(line, "=")
            {
                pos := InStr(line, "=")
                key := SubStr(line, 1, pos - 1)
                val := SubStr(line, pos + 1)
                if perKeyJson =
                    perKeyJson = "%key%":%val%
                else
                    perKeyJson = %perKeyJson%,"%key%":%val%
            }
        }
        dayObj = {"totals":{"keyboard":%kb%,"mouseLeft":%ml%,"mouseRight":%mr%,"wheelUp":%wu%,"wheelDown":%wd%},"perKey":{%perKeyJson%}}
        if dayData =
            dayData = "%dayId%":%dayObj%
        else
            dayData = %dayData%,"%dayId%":%dayObj%
    }
    if daysArr =
        daysArr = []
    else
        daysArr = [%daysArr%]
    if dayData =
        dayData = {}
    else
        dayData = {%dayData%}
    IniRead, guiX, %A_ScriptDir%\gui.ini, Floating, X, 0
    IniRead, guiY, %A_ScriptDir%\gui.ini, Floating, Y, 0
    IniRead, guiVis, %A_ScriptDir%\gui.ini, Floating, Visible, 1
    IniRead, prefW, %A_ScriptDir%\gui.ini, Preferences, Width, 160
    IniRead, prefH, %A_ScriptDir%\gui.ini, Preferences, Height, 70
    IniRead, prefT, %A_ScriptDir%\gui.ini, Preferences, Transparency, 94
    IniRead, prefB, %A_ScriptDir%\gui.ini, Preferences, BorderRadius, 14
    guiIniJson = {"Floating":{"X":"%guiX%","Y":"%guiY%","Visible":"%guiVis%"},"Preferences":{"Width":"%prefW%","Height":"%prefH%","Transparency":"%prefT%","BorderRadius":"%prefB%"}}
    jsContent = window.__KEYCOUNTER_DATA__={"currentDayId":"%metaDayId%","totals":{"keyboard":%totKb%,"mouseLeft":%totML%,"mouseRight":%totMR%,"wheelUp":%totWU%,"wheelDown":%totWD%},"days":%daysArr%,"dayData":%dayData%};window.__KEYCOUNTER_GUI_INI__=%guiIniJson%;
    dataJsLocal = %A_ScriptDir%\data_dashboard.js
    FileDelete, %dataJsLocal%
    FileAppend, %jsContent%, %dataJsLocal%
    FileCopy, %dataJsLocal%, %tempBase%\data.js, 1
    FileDelete, %dataJsLocal%
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
    SetTimer, RegenerateDashboardData, Off
    SetTimer, CheckWidgetCommand, Off
    SetTimer, FlushSave, Off
    if (needSaveState)
        Gosub, FlushSave
    dashboardTempBase =
    if (dashboardPid)
    {
        Process, Close, %dashboardPid%
        dashboardPid =
    }
    WinClose, KeyCounter Dashboard
    WinClose, KeyCounter Widget
    Reload

ExitAppLabel:
    SetTimer, RegenerateDashboardData, Off
    SetTimer, CheckWidgetCommand, Off
    SetTimer, FlushSave, Off
    if (needSaveState)
        Gosub, FlushSave
    dashboardTempBase =
    if (dashboardPid)
    {
        Process, Close, %dashboardPid%
        dashboardPid =
    }
    WinClose, KeyCounter Dashboard
    WinClose, KeyCounter Widget
    ExitApp


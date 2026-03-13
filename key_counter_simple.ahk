#Requires AutoHotkey v2
#SingleInstance Force
Persistent
SetWorkingDir A_ScriptDir

; 版本标识
scriptVersion := "v0.3-perkey-cached"
try A_TrayMenu.Tip := "KeyCounter " scriptVersion

;-------------------------
; 配置
;-------------------------
global StatsBoundaryHour := 4
global isLoggedIn := 0
global loggedInEmail := ""

;-------------------------
; 全局变量
;-------------------------
global totalKeyboard := 0
global totalMouseLeft := 0
global totalMouseRight := 0
global totalWheelUp := 0
global totalWheelDown := 0

global todayKeyboard := 0
global todayMouseLeft := 0
global todayMouseRight := 0
global todayWheelUp := 0
global todayWheelDown := 0

global isGuiShown := 0

global currentDayId := ""
global dashboardPid := 0
global apiPid := 0
global needSaveState := 0
global lastSittingReminderTime := 0
global lastTenosynovitisReminderTime := 0
global lastWaterReminderTime := 0
global continuousSessionStart := 0

global lastMouseEvent := ""
global keyName := ""
global newDayId := ""
global dashboardHash := ""
; PerKey 内存缓存，批量写入以减少 I/O
global perKeyCache := Map()

;-------------------------
; 启动与登录流程
;-------------------------
StartUp() {
    global
    SetWorkingDir A_ScriptDir
    StartApi()
    ; 尝试用本地 session 自动登录
    if (TryAutoLogin()) {
        ShowWelcome()
        StartAfterLogin()
        return
    }
    ; 弹出登录窗口
    if (!ShowLoginGui()) {
        ExitApp()
    }
    ShowWelcome()
    StartAfterLogin()
}

StartApi() {
    global apiPid
    apiScript := A_ScriptDir "\api\index.js"
    if (apiPid && apiPid != 0) {
        try ProcessClose(apiPid)
        apiPid := 0
        Sleep(500)
    }
    try Run('node "' apiScript '"', A_ScriptDir, "Hide", &apiPid)
    Sleep(2000)
}

TryAutoLogin() {
    ; 调用 /api/cloud/bootstrap 然后 /api/cloud/me
    CloudHttp("POST", "/api/cloud/bootstrap")
    resp := CloudHttp("GET", "/api/cloud/me")
    if (resp["Status"] != 200)
        return false
    if !RegExMatch(resp["Text"], '"ok"\s*:\s*true')
        return false
    email := ""
    if RegExMatch(resp["Text"], '"email"\s*:\s*"([^"]+)"', &m)
        email := m[1]
    if (email = "")
        return false
    global loggedInEmail, isLoggedIn
    loggedInEmail := email
    isLoggedIn := 1
    return true
}

ShowLoginGui() {
    global loggedInEmail, isLoggedIn
    isLoggedIn := 0
    loggedInEmail := ""
    loginGui := Gui("+AlwaysOnTop +Caption", "KeyCounter 登录")
    loginGui.MarginX := 16
    loginGui.MarginY := 16
    loginGui.AddText(, "登录后开始统计（Free：仅本地 90 天 · Pro：多设备云同步）")
    loginGui.AddText("xm ym+10", "邮箱：")
    emailEdit := loginGui.AddEdit("w260 vEmail")
    loginGui.AddText("xm y+8", "密码：")
    pwdEdit := loginGui.AddEdit("w260 Password vPassword")
    hintText := loginGui.AddText("xm y+6 cGray", "")
    btnLogin := loginGui.AddButton("xm y+10 w100", "登录")
    btnCancel := loginGui.AddButton("x+8 w80", "退出")
    loggedIn := false

    btnLogin.OnEvent("Click", LoginSubmit)
    btnCancel.OnEvent("Click", LoginClose)
    loginGui.OnEvent("Close", LoginClose)

    LoginSubmit(*) {
        global loggedInEmail, isLoggedIn
        email := emailEdit.Value
        password := pwdEdit.Value
        if (email = "" || password = "") {
            hintText.Text := "请填写邮箱和密码。"
            return
        }
        btnLogin.Enabled := false
        hintText.Text := "登录中..."
        body := '{'
            . '"email":"' email '",'
            . '"password":"' password '",'
            . '"deviceName":"This Device"'
            . '}'
        resp := CloudHttp("POST", "/api/cloud/login", body)
        if (resp["Status"] != 200 || !RegExMatch(resp["Text"], '"ok"\s*:\s*true')) {
            hintText.Text := "登录失败，请检查邮箱或密码。"
            btnLogin.Enabled := true
            return
        }
        emailFound := ""
        if RegExMatch(resp["Text"], '"email"\s*:\s*"([^"]+)"', &m2)
            emailFound := m2[1]
        if (emailFound = "")
            emailFound := email
        loggedInEmail := emailFound
        isLoggedIn := 1
        loggedIn := true
        loginGui.Destroy()
    }

    LoginClose(*) {
        loginGui.Destroy()
    }

    loginGui.Show()
    ; 阻塞等待窗口关闭
    while WinExist("KeyCounter 登录") {
        Sleep(100)
    }
    return loggedIn
}

ShowWelcome() {
    global loggedInEmail
    if (loggedInEmail = "")
        return
    welcomeGui := Gui("+AlwaysOnTop +ToolWindow -Caption", "")
    welcomeGui.MarginX := 16
    welcomeGui.MarginY := 12
    welcomeGui.AddText("cBlack", "登录成功")
    welcomeGui.AddText("cGray y+4", "欢迎 " loggedInEmail " 用户")
    welcomeGui.Show("AutoSize Center")
    SetTimer(() => welcomeGui.Destroy(), -3000)
}

CloudHttp(method, path, body := "") {
    url := "http://localhost:3000" path
    http := ComObject("WinHttp.WinHttpRequest.5.1")
    http.Open(method, url, false)
    if (method = "POST" || method = "PUT")
        http.SetRequestHeader("Content-Type", "application/json")
    try {
        http.Send(body)
        status := http.Status
        text := http.ResponseText
    } catch {
        status := 0
        text := ""
    }
    return Map("Status", status, "Text", text)
}

StartAfterLogin() {
    global
    EnsureDataDir()
    CalcDayIdStartup()
    LoadState()
    ResetHealthStatusOnStartup()
    InitGui()
    SaveState()
    SaveDaySnapshot()

    ; 托盘菜单与定时器
    A_TrayMenu.Delete()
    A_TrayMenu.Add("Open Dashboard", OpenDashboard)
    SetTimer(CheckWidgetCommand, 500)
    SetTimer(CheckHealthCommand, 500)
    SetTimer(FlushSave, 2000)
    SetTimer(CheckHealthReminders, 30000)
    A_TrayMenu.Default := "Open Dashboard"
    A_TrayMenu.Add("Preferences", Preferences)
    A_TrayMenu.Add("Show Window", ShowGui)
    A_TrayMenu.Add("Hide Window", HideGui)
    A_TrayMenu.Add("切换主题", ToggleTheme)
    A_TrayMenu.Add()
    A_TrayMenu.Add("Update check", UpdateCheck)
    A_TrayMenu.Add("Open source", OpenSource)
    A_TrayMenu.Add()
    A_TrayMenu.Add("Reset", Reset)
    A_TrayMenu.Add("Exit", ExitAppLabel)
}

StartUp()

;-------------------------
; 悬浮框右键菜单命令
;-------------------------
CheckWidgetCommand() {
    global
    widgetCmdFile := A_ScriptDir "\keycounter_widget_cmd.txt"
    if !FileExist(widgetCmdFile)
        return
    widgetCmd := FileRead(widgetCmdFile)
    FileDelete(widgetCmdFile)
    switch widgetCmd {
        case "OpenDashboard": OpenDashboard()
        case "Preferences": Preferences()
        case "ToggleTheme": ToggleTheme()
        case "UpdateCheck": UpdateCheck()
        case "OpenSource": OpenSource()
        case "Reset": Reset()
    }
}

;-------------------------
; 健康命令（Widget 长按确认）
;-------------------------
CheckHealthCommand() {
    global
    cmdFile := A_ScriptDir "\keycounter_health_cmd.txt"
    if !FileExist(cmdFile)
        return
    cmd := Trim(FileRead(cmdFile))
    FileDelete(cmdFile)
    switch cmd {
        case "WaterAck":
            global lastWaterReminderTime := A_Now
            IniWrite("0", "health_status.ini", "Status", "Water")
        case "SittingRestStart":
            IniWrite("2", "health_status.ini", "Status", "Sitting")
        case "SittingRestEnd":
            global continuousSessionStart := A_Now
            global lastSittingReminderTime := 0
            IniWrite("0", "health_status.ini", "Status", "Sitting")
    }
}

;-------------------------
; 鼠标事件（仅登录后启用）
;-------------------------
#HotIf isLoggedIn
~LButton:: {
    global lastMouseEvent := "MouseLeft"
    HandleEvent()
}
~RButton:: {
    global lastMouseEvent := "MouseRight"
    HandleEvent()
}
~WheelUp:: {
    global lastMouseEvent := "WheelUp"
    HandleEvent()
}
~WheelDown:: {
    global lastMouseEvent := "WheelDown"
    HandleEvent()
}

;-------------------------
; 键盘事件
;-------------------------
~*a:: HandleKeyEvent()
~*b:: HandleKeyEvent()
~*c:: HandleKeyEvent()
~*d:: HandleKeyEvent()
~*e:: HandleKeyEvent()
~*f:: HandleKeyEvent()
~*g:: HandleKeyEvent()
~*h:: HandleKeyEvent()
~*i:: HandleKeyEvent()
~*j:: HandleKeyEvent()
~*k:: HandleKeyEvent()
~*l:: HandleKeyEvent()
~*m:: HandleKeyEvent()
~*n:: HandleKeyEvent()
~*o:: HandleKeyEvent()
~*p:: HandleKeyEvent()
~*q:: HandleKeyEvent()
~*r:: HandleKeyEvent()
~*s:: HandleKeyEvent()
~*t:: HandleKeyEvent()
~*u:: HandleKeyEvent()
~*v:: HandleKeyEvent()
~*w:: HandleKeyEvent()
~*x:: HandleKeyEvent()
~*y:: HandleKeyEvent()
~*z:: HandleKeyEvent()
~*0:: HandleKeyEvent()
~*1:: HandleKeyEvent()
~*2:: HandleKeyEvent()
~*3:: HandleKeyEvent()
~*4:: HandleKeyEvent()
~*5:: HandleKeyEvent()
~*6:: HandleKeyEvent()
~*7:: HandleKeyEvent()
~*8:: HandleKeyEvent()
~*9:: HandleKeyEvent()
~*Space:: HandleKeyEvent()
~*Enter:: HandleKeyEvent()
~*Backspace:: HandleKeyEvent()
~*Tab:: HandleKeyEvent()
~*Delete:: HandleKeyEvent()
~*Insert:: HandleKeyEvent()
~*Home:: HandleKeyEvent()
~*End:: HandleKeyEvent()
~*PgUp:: HandleKeyEvent()
~*PgDn:: HandleKeyEvent()
~*Up:: HandleKeyEvent()
~*Down:: HandleKeyEvent()
~*Left:: HandleKeyEvent()
~*Right:: HandleKeyEvent()
~*,:: HandleKeyEvent()
~*.:: HandleKeyEvent()

~*LShift:: HandleKeyEvent()
~*RShift:: HandleKeyEvent()
~*LCtrl:: HandleKeyEvent()
~*RCtrl:: HandleKeyEvent()
~*LAlt:: HandleKeyEvent()
~*RAlt:: HandleKeyEvent()
~*CapsLock:: HandleKeyEvent()
~*Esc:: HandleKeyEvent()
~*F1:: HandleKeyEvent()
~*F2:: HandleKeyEvent()
~*F3:: HandleKeyEvent()
~*F4:: HandleKeyEvent()
~*F5:: HandleKeyEvent()
~*F6:: HandleKeyEvent()
~*F7:: HandleKeyEvent()
~*F8:: HandleKeyEvent()
~*F9:: HandleKeyEvent()
~*F10:: HandleKeyEvent()
~*F11:: HandleKeyEvent()
~*F12:: HandleKeyEvent()
#HotIf

;-------------------------
; 事件统一处理
;-------------------------
HandleKeyEvent() {
    global lastMouseEvent := "", keyName
    NormalizeKeyName()
    HandleEvent()
}

NormalizeKeyName() {
    global keyName
    keyName := StrReplace(StrReplace(StrReplace(A_ThisHotkey, "~", ""), "*", ""), "$", "")
    if (keyName = "LShift" || keyName = "RShift")
        keyName := "Shift"
    else if (keyName = "LCtrl" || keyName = "RCtrl")
        keyName := "Ctrl"
    else if (keyName = "LAlt" || keyName = "RAlt")
        keyName := "Alt"
    if (StrLen(keyName) = 1) {
        if (keyName = ",")
            keyName := "Comma"
        else if (keyName = ".")
            keyName := "Period"
        else
            keyName := StrUpper(keyName)
    }
}

HandleEvent() {
    global
    CalcDayIdRuntime()
    if (newDayId != currentDayId) {
        FlushPerKey()
        SaveDaySnapshot()
        currentDayId := newDayId
        todayKeyboard := 0
        todayMouseLeft := 0
        todayMouseRight := 0
        todayWheelUp := 0
        todayWheelDown := 0
    }
    if (lastMouseEvent = "") {
        totalKeyboard += 1
        todayKeyboard += 1
        if (keyName != "") {
            ; 内存缓存，批量写入由 FlushPerKey 处理
            cur := perKeyCache.Has(keyName) ? perKeyCache[keyName] : 0
            perKeyCache[keyName] := cur + 1
        }
    } else {
        switch lastMouseEvent {
            case "MouseLeft":
                totalMouseLeft += 1
                todayMouseLeft += 1
            case "MouseRight":
                totalMouseRight += 1
                todayMouseRight += 1
            case "WheelUp":
                totalWheelUp += 1
                todayWheelUp += 1
            case "WheelDown":
                totalWheelDown += 1
                todayWheelDown += 1
        }
    }
    needSaveState := 1
}

FlushSave() {
    global
    if (needSaveState = 0 && perKeyCache.Count = 0)
        return
    needSaveState := 0
    SaveState()
    FlushPerKey()
    SaveDaySnapshot()
}

; 将 PerKey 内存缓存批量写入 data/YYYYMMDD.ini，减少每次按键的 I/O
FlushPerKey() {
    global
    if (perKeyCache.Count = 0 || currentDayId = "")
        return
    filePath := "data\" currentDayId ".ini"
    for keyName, delta in perKeyCache {
        cur := Integer(IniRead(filePath, "PerKey", keyName, "0"))
        IniWrite(String(cur + delta), filePath, "PerKey", keyName)
    }
    perKeyCache := Map()
    IniWrite(FormatTime(, "yyyyMMddHHmmss"), filePath, "Meta", "UpdatedAt")
}

;-------------------------
; 健康提醒
;-------------------------
CheckHealthReminders() {
    CheckSittingReminder()
    CheckTenosynovitisReminder()
    CheckWaterReminder()
    WriteHealthStatus()
}

CheckSittingReminder() {
    global
    if !FileExist("gui.ini")
        return
    ; Sitting=2 表示用户已确认休息中，仅由长按绿灯结束
    sittingState := IniRead("health_status.ini", "Status", "Sitting", "0")
    if (sittingState = "2")
        return
    enabled := IniRead("gui.ini", "Preferences", "SittingEnabled", "1")
    if (enabled != "1")
        return
    sittingMins := Integer(IniRead("gui.ini", "Preferences", "SittingMinutes", "60"))
    cooldownMin := Integer(IniRead("gui.ini", "Preferences", "ReminderCooldown", "1"))
    now := A_Now
    idleMins := A_TimeIdlePhysical / 60000
    if (idleMins >= 3) {
        continuousSessionStart := now
        IniWrite("0", "health_status.ini", "Status", "Sitting")
        return
    }
    if (continuousSessionStart = 0)
        continuousSessionStart := now
    diffMins := -DateDiff(continuousSessionStart, now, "Minutes")
    if (diffMins < sittingMins) {
        IniWrite("0", "health_status.ini", "Status", "Sitting")
        return
    }
    if (lastSittingReminderTime > 0) {
        diffCooldown := -DateDiff(lastSittingReminderTime, now, "Minutes")
        if (diffCooldown < cooldownMin)
            return
    }
    lastSittingReminderTime := now
    continuousSessionStart := now
    IniWrite("1", "health_status.ini", "Status", "Sitting")
}

CheckTenosynovitisReminder() {
    global
    if !FileExist("gui.ini")
        return
    now := A_Now
    enabled := IniRead("gui.ini", "Preferences", "TenosynovitisEnabled", " ")
    if (enabled = "")
        enabled := IniRead("gui.ini", "Preferences", "ReminderEnabled", "1")
    if (enabled != "1")
        return
    kbThreshold := Integer(IniRead("gui.ini", "Preferences", "KeyboardThreshold", "50000"))
    mouseThreshold := Integer(IniRead("gui.ini", "Preferences", "MouseThreshold", "10000"))
    cooldownMin := Integer(IniRead("gui.ini", "Preferences", "ReminderCooldown", "1"))
    if (kbThreshold <= 0 && mouseThreshold <= 0) {
        IniWrite("0", "health_status.ini", "Status", "Tenosynovitis")
        return
    }
    todayMouse := todayMouseLeft + todayMouseRight + todayWheelUp + todayWheelDown
    exceeded := 0
    if (kbThreshold > 0 && todayKeyboard >= kbThreshold)
        exceeded := 1
    if (mouseThreshold > 0 && todayMouse >= mouseThreshold)
        exceeded := 1
    if (exceeded = 0) {
        IniWrite("0", "health_status.ini", "Status", "Tenosynovitis")
        return
    }
    if (lastTenosynovitisReminderTime > 0) {
        diffMins := -DateDiff(lastTenosynovitisReminderTime, now, "Minutes")
        if (diffMins < cooldownMin)
            return
    }
    lastTenosynovitisReminderTime := now
    IniWrite("1", "health_status.ini", "Status", "Tenosynovitis")
}

CheckWaterReminder() {
    global
    if !FileExist("gui.ini")
        return
    enabled := IniRead("gui.ini", "Preferences", "WaterEnabled", "1")
    if (enabled != "1")
        return
    waterMins := Integer(IniRead("gui.ini", "Preferences", "WaterMinutes", "45"))
    cooldownMin := Integer(IniRead("gui.ini", "Preferences", "ReminderCooldown", "1"))
    now := A_Now
    if (lastWaterReminderTime = 0) {
        lastWaterReminderTime := now
        IniWrite("0", "health_status.ini", "Status", "Water")
        return
    }
    diffMins := -DateDiff(lastWaterReminderTime, now, "Minutes")
    if (diffMins < waterMins)
        return
    diffCooldown := -DateDiff(lastWaterReminderTime, now, "Minutes")
    if (diffCooldown < cooldownMin)
        return
    lastWaterReminderTime := now
    IniWrite("1", "health_status.ini", "Status", "Water")
}

; 启动时重置健康状态，避免重启后沿用上次的提醒状态
ResetHealthStatusOnStartup() {
    IniWrite("0", "health_status.ini", "Status", "Sitting")
    IniWrite("0", "health_status.ini", "Status", "Tenosynovitis")
    IniWrite("0", "health_status.ini", "Status", "Water")
}

WriteHealthStatus() {
    if !FileExist("health_status.ini") {
        IniWrite("0", "health_status.ini", "Status", "Sitting")
        IniWrite("0", "health_status.ini", "Status", "Tenosynovitis")
        IniWrite("0", "health_status.ini", "Status", "Water")
    }
}

;-------------------------
; GUI：悬浮框
;-------------------------
InitGui() {
    global isGuiShown := 1
    IniWrite("1", "gui.ini", "Floating", "Visible")
    widgetDir := A_ScriptDir "\widget"
    electronExe := widgetDir "\node_modules\electron\dist\electron.exe"
    if FileExist(electronExe) {
        try Run('"' electronExe '" .', widgetDir)
    } else {
        try Run('npx electron .', widgetDir)
    }
}

ShowGui(*) {
    global isGuiShown := 1
    IniWrite("1", "gui.ini", "Floating", "Visible")
}

HideGui(*) {
    global isGuiShown := 0
    IniWrite("0", "gui.ini", "Floating", "Visible")
}

^!h:: {
    global isGuiShown
    if (isGuiShown) {
        IniWrite("0", "gui.ini", "Floating", "Visible")
        isGuiShown := 0
    } else {
        IniWrite("1", "gui.ini", "Floating", "Visible")
        isGuiShown := 1
    }
}

;-------------------------
; 主题切换
;-------------------------
ToggleTheme(*) {
    current := IniRead("gui.ini", "Preferences", "Theme", "light")
    next := (current = "dark") ? "light" : "dark"
    IniWrite(next, "gui.ini", "Preferences", "Theme")
}

;-------------------------
; GUI：看板
;-------------------------
OpenDashboard(*) {
    global dashboardHash := ""
    OpenDashboardCore()
}

OpenDashboardToPrefs() {
    global dashboardHash := "#preferences"
    OpenDashboardCore()
}

OpenDashboardCore() {
    global apiPid, dashboardPid, dashboardHash
    SetWorkingDir(A_ScriptDir)
    if (apiPid && apiPid != 0) {
        try ProcessClose(apiPid)
        apiPid := 0
        Sleep(500)
    }
    apiScript := A_ScriptDir "\api\index.js"
    try Run('node "' apiScript '"', A_ScriptDir, "Hide", &apiPid)
    Sleep(2000)
    edgePath := A_ProgramFiles "\Microsoft\Edge\Application\msedge.exe"
    edgeExists := FileExist(edgePath)
    if (!edgeExists) {
        edgePathX86 := "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
        if FileExist(edgePathX86) {
            edgePath := edgePathX86
            edgeExists := true
        }
    }
    dashboardUrl := "http://localhost:3000/" (dashboardHash ?? "")
    if (edgeExists) {
        try Run('"' edgePath '" --app="' dashboardUrl '" --window-size=900,600', , , &dashboardPid)
        SetTimer(BringDashboardToFront, 500)
    } else {
        Run(dashboardUrl)
    }
}

; 打开时置顶一次，不持续置顶
BringDashboardToFront() {
    static tries := 0
    tries += 1
    if WinExist("KeyCounter Dashboard") {
        WinActivate("KeyCounter Dashboard")
        SetTimer(BringDashboardToFront, 0)
        tries := 0
    } else if (tries >= 20) {
        SetTimer(BringDashboardToFront, 0)
        tries := 0
    }
}

;-------------------------
; 存储
;-------------------------
EnsureDataDir() {
    DirCreate("data")
}

LoadState() {
    global
    if !FileExist("count.ini")
        return
    savedDayId := IniRead("count.ini", "Meta", "DayId", currentDayId)
    totalKeyboard := Integer(IniRead("count.ini", "Total", "Keyboard", "0"))
    totalMouseLeft := Integer(IniRead("count.ini", "Total", "MouseLeft", "0"))
    totalMouseRight := Integer(IniRead("count.ini", "Total", "MouseRight", "0"))
    totalWheelUp := Integer(IniRead("count.ini", "Total", "WheelUp", "0"))
    totalWheelDown := Integer(IniRead("count.ini", "Total", "WheelDown", "0"))
    if (savedDayId = currentDayId) {
        todayKeyboard := Integer(IniRead("count.ini", "Today", "Keyboard", "0"))
        todayMouseLeft := Integer(IniRead("count.ini", "Today", "MouseLeft", "0"))
        todayMouseRight := Integer(IniRead("count.ini", "Today", "MouseRight", "0"))
        todayWheelUp := Integer(IniRead("count.ini", "Today", "WheelUp", "0"))
        todayWheelDown := Integer(IniRead("count.ini", "Today", "WheelDown", "0"))
    } else {
        todayKeyboard := 0
        todayMouseLeft := 0
        todayMouseRight := 0
        todayWheelUp := 0
        todayWheelDown := 0
    }
}

SaveState() {
    global
    IniWrite(currentDayId, "count.ini", "Meta", "DayId")
    IniWrite(String(totalKeyboard), "count.ini", "Total", "Keyboard")
    IniWrite(String(totalMouseLeft), "count.ini", "Total", "MouseLeft")
    IniWrite(String(totalMouseRight), "count.ini", "Total", "MouseRight")
    IniWrite(String(totalWheelUp), "count.ini", "Total", "WheelUp")
    IniWrite(String(totalWheelDown), "count.ini", "Total", "WheelDown")
    IniWrite(String(todayKeyboard), "count.ini", "Today", "Keyboard")
    IniWrite(String(todayMouseLeft), "count.ini", "Today", "MouseLeft")
    IniWrite(String(todayMouseRight), "count.ini", "Today", "MouseRight")
    IniWrite(String(todayWheelUp), "count.ini", "Today", "WheelUp")
    IniWrite(String(todayWheelDown), "count.ini", "Today", "WheelDown")
}

SaveDaySnapshot() {
    global
    if (currentDayId = "")
        return
    filePath := "data\" currentDayId ".ini"
    IniWrite(currentDayId, filePath, "Meta", "DayId")
    IniWrite(FormatTime(, "yyyyMMddHHmmss"), filePath, "Meta", "UpdatedAt")
    IniWrite(String(todayKeyboard), filePath, "Day", "Keyboard")
    IniWrite(String(todayMouseLeft), filePath, "Day", "MouseLeft")
    IniWrite(String(todayMouseRight), filePath, "Day", "MouseRight")
    IniWrite(String(todayWheelUp), filePath, "Day", "WheelUp")
    IniWrite(String(todayWheelDown), filePath, "Day", "WheelDown")
}

;-------------------------
; 日界线计算
;-------------------------
CalcDayIdStartup() {
    global currentDayId
    now := A_Now
    hour := Integer(FormatTime(now, "HH"))
    if (hour >= StatsBoundaryHour) {
        currentDayId := FormatTime(now, "yyyyMMdd")
        return
    }
    shifted := DateAdd(now, -1, "days")
    currentDayId := FormatTime(shifted, "yyyyMMdd")
}

CalcDayIdRuntime() {
    global newDayId
    now := A_Now
    hour := Integer(FormatTime(now, "HH"))
    if (hour >= StatsBoundaryHour) {
        newDayId := FormatTime(now, "yyyyMMdd")
        return
    }
    shifted := DateAdd(now, -1, "days")
    newDayId := FormatTime(shifted, "yyyyMMdd")
}

;-------------------------
; 托盘菜单动作
;-------------------------
Preferences(*) {
    OpenDashboardToPrefs()
}

UpdateCheck(*) {
}

OpenSource(*) {
    Run("https://github.com/Van-Wu1/Viki-YourKeyCounter")
}

Reset(*) {
    global
    SetTimer(CheckWidgetCommand, 0)
    SetTimer(CheckHealthCommand, 0)
    SetTimer(FlushSave, 0)
    SetTimer(CheckHealthReminders, 0)
    FlushSave()
    if (apiPid && apiPid != 0) {
        try ProcessClose(apiPid)
        apiPid := 0
    }
    if (dashboardPid && dashboardPid != 0) {
        try ProcessClose(dashboardPid)
        dashboardPid := 0
    }
    CloseWidgetProcess()
    try WinClose("KeyCounter Dashboard")
    try WinClose("KeyCounter Widget")
    Reload()
}

ExitAppLabel(*) {
    global
    SetTimer(CheckWidgetCommand, 0)
    SetTimer(CheckHealthCommand, 0)
    SetTimer(FlushSave, 0)
    SetTimer(CheckHealthReminders, 0)
    FlushSave()
    if (apiPid && apiPid != 0) {
        try ProcessClose(apiPid)
        apiPid := 0
    }
    if (dashboardPid && dashboardPid != 0) {
        try ProcessClose(dashboardPid)
        dashboardPid := 0
    }
    CloseWidgetProcess()
    try WinClose("KeyCounter Dashboard")
    try WinClose("KeyCounter Widget")
    ExitApp()
}

CloseWidgetProcess() {
    widgetPidFile := A_ScriptDir "\keycounter_widget_pid.txt"
    if FileExist(widgetPidFile) {
        widgetPid := Trim(FileRead(widgetPidFile))
        pid := Integer(widgetPid)
        if (pid > 0)
            try ProcessClose(pid)
        FileDelete(widgetPidFile)
    }
}

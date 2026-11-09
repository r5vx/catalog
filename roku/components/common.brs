' Shared by the screens: asking Catalog on the computer for things, and what it needs to know
' about this Roku.

' Asks Catalog for `path` (with `query`, a set of names and values). An ApiTask does the asking,
' off the screen's thread; when it answers, `callback` (a sub on this screen) is called with the
' task's response: { ok, code, data, signIn }.
function api(path as String, query as Object, callback as String, method = "GET" as String, body = invalid as Dynamic) as Object
    task = CreateObject("roSGNode", "ApiTask")
    task.request = { path: path, query: query, method: method, body: body }
    task.observeField("response", callback)
    task.control = "RUN"
    if m.tasks = invalid then m.tasks = []
    ' (Kept, so it isn't thrown away before it answers.)
    m.tasks.Push(task)
    if m.tasks.Count() > 20 then m.tasks.Shift()
    return task
end function

' What Catalog needs from this Roku with every request: that it's a TV, whose profile is
' watching, and the PIN's sign-in if there is one.
function catalogHeaders() as Object
    cookie = "catalog_profile=" + m.global.profile.ToStr()
    if m.global.token <> "" then cookie = cookie + "; catalog_auth=" + m.global.token
    return { "User-Agent": "CatalogTV/1.0 (Roku)", "Cookie": cookie }
end function

' The same, as a video asks with them ("Name:Value"), plus any of its own.
function videoHeaders(extra as Object) as Object
    headers = catalogHeaders()
    list = ["Cookie:" + headers["Cookie"], "User-Agent:" + headers["User-Agent"]]
    if extra <> invalid then
        for each line in extra
            list.Push(line)
        end for
    end if
    return list
end function

' Any value as text (numbers too).
function text(value as Dynamic) as String
    if value = invalid then return ""
    valueType = type(value)
    if valueType = "String" or valueType = "roString" then return value
    return value.ToStr()
end function

' A whole number, or 0 when there's none.
function number(value as Dynamic) as Integer
    if value = invalid then return 0
    return Int(value)
end function

' A content item with Catalog's own fields on it.
function contentItem(fields as Object) as Object
    node = CreateObject("roSGNode", "ContentNode")
    node.addFields(fields)
    return node
end function

' Where a tile's OK goes (its `go`, from /api/roku/rows): a title's page, or the player.
function actionFor(go as Object) as Object
    if go.place = "title" then return { go: "title", source: go.source, sourceId: go.sourceId }
    if go.place = "replay" then return { go: "play", replay: go.replay, label: go.label }
    return { go: "play", title: go.title, type: go.type, year: text(go.year), season: number(go.season), episode: number(go.episode) }
end function

' The remote's * on a tile: what it offers (its `actions`, as the Fire TV's menu button), in a
' box. Picking one makes its calls one after another, then the screen loads again (`resumed`).
sub showActions(title as String, actions as Object)
    if actions = invalid or actions.Count() = 0 then return
    m.tileActions = actions
    labels = []
    for each one in actions
        labels.Push(one.label)
    end for
    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = title
    dialog.buttons = labels
    dialog.observeField("buttonSelected", "onTileAction")
    m.actionsDialog = dialog
    m.top.getScene().dialog = dialog
end sub

sub onTileAction()
    chosen = m.tileActions[m.actionsDialog.buttonSelected]
    m.actionsDialog.close = true
    m.pendingCalls = []
    for each call in chosen.calls
        m.pendingCalls.Push(call)
    end for
    nextTileCall()
end sub

sub nextTileCall()
    if m.pendingCalls.Count() = 0 then
        m.top.resumed = true
        return
    end if
    call = m.pendingCalls.Shift()
    api(call.path, {}, "onTileCallDone", call.method, call.body)
end sub

sub onTileCallDone()
    nextTileCall()
end sub

' A setting kept on this Roku (registry): on/off as "1"/"0", anything else as it is.
sub keepSetting(name as String, value as Dynamic)
    saved = CreateObject("roRegistrySection", "catalog")
    if type(value) = "Boolean" or type(value) = "roBoolean" then
        if value then saved.Write(name, "1") else saved.Write(name, "0")
    else
        saved.Write(name, text(value))
    end if
    saved.Flush()
end sub

' This Roku app's version as one number (major, minor, build: 1.2.3 is 10203), from its manifest,
' to tell whether the computer has a newer one (/api/roku/hello `rokuApp`).
function appVersion() as Integer
    manifest = ReadAsciiFile("pkg:/manifest")
    parts = { major: 0, minor: 0, build: 0 }
    for each line in manifest.Split(Chr(10))
        line = line.Trim()
        if Left(line, 14) = "major_version=" then parts.major = Mid(line, 15).ToInt()
        if Left(line, 14) = "minor_version=" then parts.minor = Mid(line, 15).ToInt()
        if Left(line, 14) = "build_version=" then parts.build = Mid(line, 15).ToInt()
    end for
    return parts.major * 10000 + parts.minor * 100 + parts.build
end function

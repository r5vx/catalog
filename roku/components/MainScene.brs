' As on the Fire TV: the menu's screens (Search, Home, Movies, TV Shows, Anime, My Library,
' Live TV, Settings) sit beside the menu; a title's page, the player, "Who's watching" and
' finding the computer open over them, one on another. Back closes the top one; on a menu
' screen it opens the menu; with the menu open it goes Home; from Home it leaves the app.
' Each screen asks for the next by setting its `action` field: { go: "title", ... }.
' Where Catalog is, its PIN sign-in, the profile watching and the player's settings are kept on
' the Roku (registry).

sub init()
    m.top.backgroundColor = "0x111614FF"
    m.top.backgroundURI = ""
    m.global.addFields({ server: "", token: "", profile: 0, profileName: "", profileColor: "", captions: true, autoSkip: true, autoplay: true })
    saved = CreateObject("roRegistrySection", "catalog")
    if saved.Exists("server") then m.global.server = saved.Read("server")
    if saved.Exists("token") then m.global.token = saved.Read("token")
    if saved.Exists("profile") then m.global.profile = saved.Read("profile").ToInt()
    if saved.Exists("profileName") then m.global.profileName = saved.Read("profileName")
    if saved.Exists("profileColor") then m.global.profileColor = saved.Read("profileColor")
    ' On a TV these start on, as on the Fire TV (each can be turned off in Settings).
    for each name in ["captions", "autoSkip", "autoplay"]
        if saved.Exists(name) then m.global.setField(name, saved.Read(name) = "1")
    end for
    m.menuScreenGroup = m.top.findNode("menuScreen")
    m.nav = m.top.findNode("nav")
    m.nav.observeField("chosen", "onMenu")
    m.screens = m.top.findNode("screens")
    m.stack = []
    m.menuScreen = invalid
    m.place = ""
    push("connect", {})
end sub

' The screen component for each place.
function screenFor(place as String) as String
    names = {
        connect: "ConnectScreen", profiles: "ProfileScreen", title: "TitleScreen", play: "PlayerScreen",
        home: "ShelfScreen", movies: "ShelfScreen", tv: "ShelfScreen", anime: "ShelfScreen",
        library: "LibraryScreen", live: "LiveScreen", search: "SearchScreen", settings: "SettingsScreen"
    }
    return names[place]
end function

function isMenuPlace(place as String) as Boolean
    return Instr(1, " home movies tv anime library live search settings ", " " + place + " ") > 0
end function

' One of the menu's screens, beside the menu (the one before goes).
sub showMenuScreen(place as String)
    m.nav.who = m.global.profileName
    m.nav.whoColor = m.global.profileColor
    m.nav.visible = true
    m.nav.current = place
    if m.place <> place or m.menuScreen = invalid then
        if m.menuScreen <> invalid then
            m.menuScreen.unobserveField("action")
            m.menuScreen.closing = true
            m.menuScreenGroup.removeChild(m.menuScreen)
        end if
        screen = CreateObject("roSGNode", screenFor(place))
        screen.observeField("action", "onAction")
        m.menuScreenGroup.appendChild(screen)
        m.menuScreen = screen
        m.place = place
        screen.params = { place: place }
    end if
    m.menuScreenGroup.visible = true
    m.menuScreen.setFocus(true)
end sub

' A screen over everything (the menu and its screen hidden meanwhile).
sub push(place as String, params as Object)
    if m.stack.Count() > 0 then m.stack.Peek().visible = false
    m.nav.visible = false
    m.menuScreenGroup.visible = false
    screen = CreateObject("roSGNode", screenFor(place))
    screen.observeField("action", "onAction")
    m.screens.appendChild(screen)
    m.stack.Push(screen)
    screen.params = params
    screen.setFocus(true)
end sub

' The top screen goes (told first, to stop its video and save its place).
sub pop()
    screen = m.stack.Pop()
    screen.unobserveField("action")
    screen.closing = true
    m.screens.removeChild(screen)
    if m.stack.Count() > 0 then
        under = m.stack.Peek()
        under.visible = true
        under.setFocus(true)
        under.resumed = true
    else if m.menuScreen <> invalid then
        m.nav.visible = true
        m.menuScreenGroup.visible = true
        m.menuScreen.setFocus(true)
        m.menuScreen.resumed = true
    end if
end sub

sub clearStack()
    while m.stack.Count() > 0
        screen = m.stack.Pop()
        screen.unobserveField("action")
        screen.closing = true
        m.screens.removeChild(screen)
    end while
end sub

sub onMenu()
    place = m.nav.chosen
    if place = "profiles" then
        push("profiles", {})
    else
        showMenuScreen(place)
    end if
end sub

sub onAction(event as Object)
    action = event.getData()
    if action = invalid or action.go = invalid then return
    go = action.go
    if go = "back" then
        if m.stack.Count() > 0 then pop()
    else if go = "connect" then
        clearStack()
        push("connect", action)
    else if go = "replace" then
        if m.stack.Count() > 0 then pop()
        push(action.place, action)
    else if isMenuPlace(go) then
        ' (After connecting or picking who's watching: a fresh start there.)
        clearStack()
        if go = "home" and m.menuScreen <> invalid then m.menuScreen.resumed = true
        showMenuScreen(go)
    else
        push(go, action)
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    onMenuScreen = m.stack.Count() = 0 and m.menuScreen <> invalid
    if key = "back" then
        if m.stack.Count() > 0 then
            ' The first screen (finding the computer) can't be backed out of into nothing.
            if m.menuScreen = invalid and m.stack.Count() = 1 then return false
            pop()
            return true
        end if
        if onMenuScreen and not m.nav.isInFocusChain() then
            m.nav.setFocus(true)
            return true
        end if
        if onMenuScreen and m.place <> "home" then
            showMenuScreen("home")
            m.nav.setFocus(true)
            return true
        end if
        return false
    end if
    ' Left from a screen's first column opens the menu; right from the menu goes back to the screen.
    if key = "left" and onMenuScreen and not m.nav.isInFocusChain() then
        m.nav.setFocus(true)
        return true
    end if
    if key = "right" and onMenuScreen and m.nav.isInFocusChain() then
        m.menuScreen.setFocus(true)
        return true
    end if
    return false
end function

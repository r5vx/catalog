sub init()
    m.status = m.top.findNode("status")
    m.choices = m.top.findNode("choices")
    m.choices.observeField("itemSelected", "onChoice")
    m.found = []
    m.top.observeField("focusedChild", "onFocus")
end sub

sub onFocus()
    if m.top.hasFocus() then m.choices.setFocus(true)
end sub

' The last computer first, if there was one; otherwise (or if it doesn't answer) look around.
sub start()
    if m.global.server <> "" then
        m.status.text = "Connecting to Catalog…"
        m.helloAsk = api("/api/roku/hello", {}, "onHello")
    else
        discover()
    end if
end sub

sub discover()
    m.status.text = "Looking for Catalog on your computers…"
    m.discover = CreateObject("roSGNode", "DiscoverTask")
    m.discover.observeField("found", "onFound")
    m.discover.control = "RUN"
end sub

sub onFound(event as Object)
    m.found = event.getData()
    list = CreateObject("roSGNode", "ContentNode")
    for each computer in m.found
        item = list.createChild("ContentNode")
        item.title = computer.name
    end for
    item = list.createChild("ContentNode")
    item.title = "Type the computer's address"
    item = list.createChild("ContentNode")
    item.title = "Look again"
    m.choices.content = list
    if m.found.Count() = 0 then
        m.status.text = "No computer with Catalog open answered. Open Catalog on the computer, then Look again, or type its address."
    else
        m.status.text = "Which computer?"
    end if
    m.choices.setFocus(true)
end sub

sub onChoice()
    at = m.choices.itemSelected
    if at < m.found.Count() then
        connectTo(m.found[at].address)
    else if at = m.found.Count() then
        askAddress()
    else
        discover()
    end if
end sub

sub connectTo(address as String)
    if address <> m.global.server then m.global.token = ""
    m.global.server = address
    m.status.text = "Connecting to Catalog…"
    m.profilesAsk = invalid
    m.loginAsk = invalid
    m.helloAsk = api("/api/roku/hello", {}, "onHello")
end sub

sub onHello(event as Object)
    if not isCurrentRequest(event, m.helloAsk) then return
    answer = event.getData()
    if not answer.ok or answer.data.app <> "catalog" then
        m.status.text = "Catalog didn't answer at " + m.global.server + "."
        m.global.server = ""
        discover()
        return
    end if
    m.needsPin = answer.data.pin = true
    if not m.needsPin then m.global.token = ""
    ' Whether the PIN sign-in kept from before still works (asked for who's watching).
    m.profilesAsk = api("/api/roku/profiles", {}, "onProfiles")
end sub

sub onProfiles(event as Object)
    if not isCurrentRequest(event, m.profilesAsk) then return
    answer = event.getData()
    if answer.signIn or (m.needsPin and not answer.ok) then
        askPin("")
        return
    end if
    if not answer.ok then
        m.status.text = "Catalog didn't answer. Look again?"
        discover()
        return
    end if
    saved = CreateObject("roRegistrySection", "catalog")
    saved.Write("server", m.global.server)
    saved.Write("token", m.global.token)
    saved.Flush()
    ' More than one person watches: who's watching, every time the app opens (as on the Fire TV).
    ' Only the first time, a Roku set up as one person stayed them: a new profile was never asked
    ' about, and its person saw someone else's library (2026-11-08).
    if answer.data.profiles.Count() > 1 then
        m.top.action = { go: "profiles" }
    else
        if answer.data.profiles.Count() = 1 then
            only = answer.data.profiles[0]
            m.global.profile = only.id
            m.global.profileName = only.name
            saved.Write("profile", only.id.ToStr())
            saved.Write("profileName", only.name)
            saved.Flush()
        end if
        m.top.action = { go: "home" }
    end if
end sub

sub askAddress()
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.title = "The computer's address"
    dialog.message = ["Like 192.168.1.20, the address phones use for Catalog."]
    dialog.buttons = ["Connect", "Cancel"]
    dialog.observeField("buttonSelected", "onAddress")
    m.dialog = dialog
    m.top.getScene().dialog = dialog
end sub

sub onAddress()
    typed = m.dialog.text.Trim()
    chose = m.dialog.buttonSelected
    m.dialog.close = true
    if chose <> 0 or typed = "" then return
    if Left(typed, 4) <> "http" then typed = "http://" + typed
    ' The usual port, unless one was typed.
    if Instr(8, typed, ":") = 0 then typed = typed + ":4173"
    connectTo(typed)
end sub

sub askPin(problem as String)
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.title = "Catalog's PIN"
    message = ["The PIN Catalog asks for on phones."]
    if problem <> "" then message = [problem]
    dialog.message = message
    dialog.keyboardDomain = "numeric"
    dialog.buttons = ["OK", "Cancel"]
    dialog.observeField("buttonSelected", "onPin")
    m.dialog = dialog
    m.top.getScene().dialog = dialog
end sub

sub onPin()
    pin = m.dialog.text.Trim()
    chose = m.dialog.buttonSelected
    m.dialog.close = true
    if chose <> 0 then
        m.status.text = "Catalog needs its PIN."
        discover()
        return
    end if
    m.loginAsk = api("/api/roku/login", {}, "onLogin", "POST", { pin: pin })
end sub

sub onLogin(event as Object)
    if not isCurrentRequest(event, m.loginAsk) then return
    answer = event.getData()
    if not answer.ok then
        askPin("That PIN is not right. Try again.")
        return
    end if
    m.global.token = answer.data.token
    m.profilesAsk = api("/api/roku/profiles", {}, "onProfiles")
end sub

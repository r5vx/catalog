sub init()
    m.options = m.top.findNode("options")
    m.about = m.top.findNode("about")
    m.options.observeField("itemSelected", "onPick")
    m.top.observeField("focusedChild", "onFocus")
end sub

sub onFocus()
    if m.top.hasFocus() then m.options.setFocus(true)
end sub

function onOff(on as Boolean) as String
    if on then return "On"
    return "Off"
end function

sub show()
    who = m.global.profileName
    if who = "" then who = "Me"
    lines = [
        "Who's watching: " + who,
        "Captions: " + onOff(m.global.captions),
        "Skip intros, recaps and credits by itself: " + onOff(m.global.autoSkip),
        "Play the next episode by itself: " + onOff(m.global.autoplay),
        "Change computer"
    ]
    content = CreateObject("roSGNode", "ContentNode")
    for each line in lines
        item = content.createChild("ContentNode")
        item.title = line
    end for
    at = m.options.itemFocused
    m.options.content = content
    if at > 0 then m.options.jumpToItem = at
    m.about.text = "Catalog on " + m.global.server
end sub

sub toggle(name as String)
    value = not m.global.getField(name)
    m.global.setField(name, value)
    saved = CreateObject("roRegistrySection", "catalog")
    if value then saved.Write(name, "1") else saved.Write(name, "0")
    saved.Flush()
    show()
end sub

sub onPick()
    at = m.options.itemSelected
    if at = 0 then
        m.top.action = { go: "profiles" }
    else if at = 1 then
        toggle("captions")
    else if at = 2 then
        toggle("autoSkip")
    else if at = 3 then
        toggle("autoplay")
    else
        saved = CreateObject("roRegistrySection", "catalog")
        saved.Delete("server")
        saved.Flush()
        m.global.server = ""
        m.top.action = { go: "connect" }
    end if
end sub

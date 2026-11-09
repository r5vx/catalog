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
    sizes = { small: "Small", medium: "Medium", large: "Large", huge: "Extra large" }
    size = sizes[m.global.captionSize]
    if size = invalid then size = "Medium"
    look = "Shadow"
    if m.global.captionBox then look = "Dark box"
    m.lines = [
        { label: "Who's watching: " + who, act: "profiles" },
        { label: "Captions: " + onOff(m.global.captions), act: "captions" },
        { label: "Auto-timing captions: " + onOff(m.global.autoTiming), act: "autoTiming" },
        { label: "Caption size: " + size, act: "size" },
        { label: "Caption look: " + look, act: "captionBox" },
        { label: "Skip intros, recaps and credits by itself: " + onOff(m.global.autoSkip), act: "autoSkip" },
        { label: "Play the next episode by itself: " + onOff(m.global.autoplay), act: "autoplay" },
        { label: "Change computer", act: "computer" }
    ]
    lines = []
    for each line in m.lines
        lines.Push(line.label)
    end for
    content = CreateObject("roSGNode", "ContentNode")
    for each line in lines
        item = content.createChild("ContentNode")
        item.title = line
    end for
    at = m.options.itemFocused
    m.options.content = content
    if at > 0 then m.options.jumpToItem = at
    m.about.text = "Catalog on " + m.global.server + Chr(10) + "While watching, Down opens the player's menu: captions, their timing and size, the source and the sound."
    if m.global.rokuOutdated then m.about.text = m.about.text + Chr(10) + "The computer has a newer version of this app: on the computer, Settings, Watch on TV, Install on Roku."
end sub

sub toggle(name as String)
    value = not m.global.getField(name)
    m.global.setField(name, value)
    keepSetting(name, value)
    show()
end sub

sub onPick()
    act = m.lines[m.options.itemSelected].act
    if act = "profiles" then
        m.top.action = { go: "profiles" }
    else if act = "size" then
        order = ["small", "medium", "large", "huge"]
        upcoming = "medium"
        for i = 0 to order.Count() - 1
            if order[i] = m.global.captionSize then upcoming = order[(i + 1) mod order.Count()]
        end for
        m.global.captionSize = upcoming
        keepSetting("captionSize", upcoming)
        show()
    else if act <> "computer" then
        toggle(act)
    else
        saved = CreateObject("roRegistrySection", "catalog")
        saved.Delete("server")
        saved.Flush()
        m.global.server = ""
        m.top.action = { go: "connect" }
    end if
end sub

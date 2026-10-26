sub init()
    m.people = m.top.findNode("people")
    m.people.observeField("itemSelected", "onPick")
    m.top.observeField("focusedChild", "onFocus")
end sub

sub onFocus()
    if m.top.hasFocus() then m.people.setFocus(true)
end sub

sub start()
    api("/api/roku/profiles", {}, "onProfiles")
end sub

' "#e994c2" (as Catalog keeps it) → "0xE994C2FF" (as the Roku draws it).
function rokuColor(color as String) as String
    if Left(color, 1) <> "#" or Len(color) <> 7 then return "0xE994C2FF"
    return "0x" + UCase(Mid(color, 2)) + "FF"
end function

sub onProfiles(event as Object)
    answer = event.getData()
    if not answer.ok then
        m.top.action = { go: "connect" }
        return
    end if
    m.list = answer.data.profiles
    content = CreateObject("roSGNode", "ContentNode")
    for each person in m.list
        item = contentItem({ kind: "profile", color: rokuColor(text(person.color)), under: person.name, progress: 0.0 })
        item.title = person.name
        content.appendChild(item)
    end for
    ' Centered, however many there are.
    count = m.list.Count()
    if count > 6 then count = 6
    m.people.translation = [(1920 - (count * 220 + (count - 1) * 50)) / 2, 420]
    m.people.content = content
    for i = 0 to m.list.Count() - 1
        if m.list[i].id = m.global.profile then m.people.jumpToItem = i
    end for
    m.people.setFocus(true)
end sub

sub onPick()
    person = m.list[m.people.itemSelected]
    m.global.profile = person.id
    m.global.profileName = person.name
    m.global.profileColor = rokuColor(text(person.color))
    saved = CreateObject("roRegistrySection", "catalog")
    saved.Write("profile", person.id.ToStr())
    saved.Write("profileName", person.name)
    saved.Write("profileColor", m.global.profileColor)
    saved.Flush()
    m.top.action = { go: "home" }
end sub

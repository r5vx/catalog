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
    ' Add profile, at the end (Catalog keeps eight at most).
    m.canAdd = m.list.Count() < 8
    if m.canAdd then
        item = contentItem({ kind: "profile", color: "0x2A3330FF", under: "Add profile", progress: 0.0 })
        item.title = "+"
        content.appendChild(item)
    end if
    ' Centered, however many there are.
    count = content.getChildCount()
    if count > 6 then count = 6
    m.people.translation = [(1920 - (count * 220 + (count - 1) * 50)) / 2, 420]
    m.people.content = content
    for i = 0 to m.list.Count() - 1
        if m.list[i].id = m.global.profile then m.people.jumpToItem = i
    end for
    m.people.setFocus(true)
end sub

sub onPick()
    if m.people.itemSelected >= m.list.Count() then
        askName()
        return
    end if
    pickPerson(m.people.itemSelected)
end sub

' Watching as person `at` (of m.list) on this Roku from now on.
sub pickPerson(at as Integer)
    person = m.list[at]
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

' Add profile: a name with the Roku's keyboard, then watching as them.
sub askName()
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.title = "Add profile"
    dialog.message = ["Their name"]
    dialog.buttons = ["Add", "Cancel"]
    dialog.observeField("buttonSelected", "onName")
    m.nameDialog = dialog
    m.top.getScene().dialog = dialog
end sub

sub onName()
    name = m.nameDialog.text.Trim()
    picked = m.nameDialog.buttonSelected
    m.nameDialog.close = true
    if picked <> 0 or name = "" then return
    m.newName = name
    api("/api/profiles", {}, "onAdded", "POST", { action: "add", name: name })
end sub

sub onAdded(event as Object)
    answer = event.getData()
    if not answer.ok or answer.data.id = invalid then return
    m.list.Push({ id: answer.data.id, name: m.newName, color: "#e994c2" })
    ' Watching as them straight away (and they're on the list next time).
    pickPerson(m.list.Count() - 1)
end sub

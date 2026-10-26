sub init()
    m.keyboard = m.top.findNode("keyboard")
    m.results = m.top.findNode("results")
    m.status = m.top.findNode("status")
    m.pause = m.top.findNode("pause")
    m.keyboard.observeField("text", "onTyping")
    m.pause.observeField("fire", "search")
    m.results.observeField("itemSelected", "onPick")
    m.top.observeField("focusedChild", "onFocus")
    m.asked = ""
end sub

sub onFocus()
    if m.top.hasFocus() then m.keyboard.setFocus(true)
end sub

' Waits for a pause in typing, so it doesn't search every letter.
sub onTyping()
    m.pause.control = "stop"
    m.pause.control = "start"
end sub

sub search()
    words = m.keyboard.text.Trim()
    if Len(words) < 2 then
        m.results.visible = false
        m.status.visible = true
        m.status.text = "Type a film, show or anime."
        return
    end if
    m.asked = words
    m.status.text = "Searching…"
    api("/api/search", { q: words }, "onResults")
end sub

sub onResults(event as Object)
    answer = event.getData()
    if not answer.ok then return
    ' (A slower answer to something typed before.)
    if m.keyboard.text.Trim() <> m.asked then return
    content = CreateObject("roSGNode", "ContentNode")
    for each found in answer.data.results
        if content.getChildCount() >= 20 then exit for
        item = contentItem({ kind: "poster", source: found.source, sourceId: found.sourceId, progress: 0.0 })
        item.title = found.title
        if found.year <> invalid then item.shortDescriptionLine1 = text(found.year)
        if found.posterUrl <> invalid then item.hdPosterUrl = found.posterUrl
        content.appendChild(item)
    end for
    m.results.content = content
    m.results.visible = content.getChildCount() > 0
    m.status.visible = not m.results.visible
    if not m.results.visible then m.status.text = "Nothing found for " + Chr(34) + m.asked + Chr(34) + "."
end sub

sub onPick()
    item = m.results.content.getChild(m.results.itemSelected)
    m.top.action = { go: "title", source: item.source, sourceId: item.sourceId, label: item.title }
end sub

' Right from the keyboard goes into what was found; left from the first column comes back.
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "right" and m.keyboard.isInFocusChain() and m.results.visible then
        m.results.setFocus(true)
        return true
    else if key = "left" and m.results.isInFocusChain() then
        m.keyboard.setFocus(true)
        return true
    end if
    return false
end function

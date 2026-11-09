' YouTube's own places (src/lib/server/youtubeTv.ts), in the order its TV app has them. Home (the
' first rows of the others) comes first, so it opens on videos, not a search box.
function placeList() as Object
    return [
        { id: "home", label: "Home" },
        { id: "search", label: "Search" },
        { id: "music", label: "Music" },
        { id: "gaming", label: "Gaming" },
        { id: "news", label: "News" },
        { id: "sports", label: "Sports" },
        { id: "live", label: "Live" },
        { id: "movies", label: "Movies" },
        { id: "podcasts", label: "Podcasts" }
    ]
end function

sub init()
    m.places = m.top.findNode("places")
    m.where = m.top.findNode("where")
    m.status = m.top.findNode("status")
    m.rows = m.top.findNode("rows")
    m.searchView = m.top.findNode("searchView")
    m.keyboard = m.top.findNode("keyboard")
    m.found = m.top.findNode("found")
    m.results = m.top.findNode("results")
    m.pause = m.top.findNode("pause")
    m.settle = m.top.findNode("settle")

    m.list = placeList()
    content = CreateObject("roSGNode", "ContentNode")
    for each place in m.list
        item = content.createChild("ContentNode")
        item.title = place.label
    end for
    m.places.content = content

    m.keyboard.observeField("text", "onTyping")
    m.pause.observeField("fire", "search")
    m.results.observeField("itemSelected", "onPickResult")
    m.rows.observeField("rowItemSelected", "onPickTile")
    m.places.observeField("itemFocused", "onPlaceMoved")
    m.places.observeField("itemSelected", "onPlacePicked")
    m.settle.observeField("fire", "showPlace")
    m.top.observeField("focusedChild", "onFocus")

    m.asked = ""
    m.place = ""
    ' A channel or playlist opened from a row: Back comes out of them, one at a time.
    m.opened = []
    m.tiles = []
    m.wanted = ""
    showPlace()
end sub

sub onFocus()
    if m.top.hasFocus() then m.places.setFocus(true)
end sub

' Moving down the places shows each one once the highlight rests on it.
sub onPlaceMoved()
    m.settle.control = "stop"
    m.settle.control = "start"
end sub

sub onPlacePicked()
    showPlace()
    goRight()
end sub

sub showPlace()
    at = m.places.itemFocused
    if at < 0 or at >= m.list.Count() then at = 0
    place = m.list[at].id
    if place = m.place and m.opened.Count() = 0 then return
    m.place = place
    m.opened = []
    if place = "search" then
        m.where.text = ""
        m.rows.visible = false
        m.status.visible = false
        m.searchView.visible = true
        return
    end if
    m.searchView.visible = false
    loadRows(place, "", m.list[at].label)
end sub

sub loadRows(place as String, id as String, label as String)
    m.wanted = place + "|" + id
    m.where.text = label
    m.rows.visible = false
    m.status.visible = true
    m.status.text = "Loading…"
    api("/api/youtube/rows", { place: place, id: id }, "onRows")
end sub

sub onRows(event as Object)
    answer = event.getData()
    if answer.ok and answer.data.asked <> invalid and answer.data.asked <> m.wanted then return
    if not answer.ok then
        if answer.signIn then
            m.top.action = { go: "connect" }
            return
        end if
        m.status.text = "YouTube didn't answer. Is Catalog open on the computer?"
        return
    end if
    m.tiles = []
    content = CreateObject("roSGNode", "ContentNode")
    for each row in answer.data.rows
        node = content.createChild("ContentNode")
        node.title = row.title
        tiles = []
        for each found in row.items
            node.appendChild(tileItem(found))
            tiles.Push(found)
        end for
        m.tiles.Push(tiles)
    end for
    if m.tiles.Count() = 0 then
        m.status.text = "Nothing here right now."
        return
    end if
    m.rows.content = content
    m.rows.jumpToRowItem = [0, 0]
    m.rows.visible = true
    m.status.visible = false
end sub

' A wide picture, the name under it, then the channel, views and when (or the length).
function tileItem(found as Object) as Object
    item = contentItem({ kind: "episode", videoId: found.id, under: found.title })
    item.title = found.title
    item.hdPosterUrl = found.thumb
    line = text(found.line)
    if found.kind = "channel" then line = "Channel"
    if found.kind = "playlist" then line = "Playlist" + Chr(32) + Chr(183) + Chr(32) + line
    if found.length <> invalid and found.length <> "" and found.kind = "video" then line = found.length + Chr(32) + Chr(183) + Chr(32) + line
    item.shortDescriptionLine1 = line
    return item
end function

sub onPickTile()
    at = m.rows.rowItemSelected
    if at = invalid or at.Count() < 2 or at[0] >= m.tiles.Count() then return
    row = m.tiles[at[0]]
    if at[1] >= row.Count() then return
    found = row[at[1]]
    if found.kind = "video" then
        m.top.action = { go: "play", youtube: found.id, label: found.title }
    else
        m.opened.Push({ place: found.kind, id: found.id, label: found.title })
        loadRows(found.kind, found.id, found.title)
        m.rows.setFocus(true)
    end if
end sub

' Back out of a channel or playlist: the one before it, or the place itself.
sub goBack()
    m.opened.Pop()
    if m.opened.Count() > 0 then
        last = m.opened[m.opened.Count() - 1]
        loadRows(last.place, last.id, last.label)
    else
        at = m.places.itemFocused
        if at < 0 or at >= m.list.Count() then at = 0
        loadRows(m.place, "", m.list[at].label)
    end if
end sub

sub goRight()
    if m.place = "search" then
        m.keyboard.setFocus(true)
    else if m.rows.visible then
        m.rows.setFocus(true)
    end if
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
        m.found.visible = true
        m.found.text = "Search YouTube."
        return
    end if
    m.asked = words
    m.found.text = "Searching…"
    api("/api/youtube/search", { q: words }, "onResults")
end sub

sub onResults(event as Object)
    answer = event.getData()
    if m.keyboard.text.Trim() <> m.asked then return
    if not answer.ok then
        m.results.visible = false
        m.found.visible = true
        m.found.text = "YouTube didn't answer. Try again."
        return
    end if
    content = CreateObject("roSGNode", "ContentNode")
    for each found in answer.data.results
        if content.getChildCount() >= 18 then exit for
        item = contentItem({ kind: "episode", videoId: found.id, under: found.title })
        item.title = found.title
        item.hdPosterUrl = found.thumb
        line = found.channel
        if found.length <> invalid and found.length <> "" then line = line + "  ·  " + found.length
        item.shortDescriptionLine1 = line
        content.appendChild(item)
    end for
    m.results.content = content
    m.results.visible = content.getChildCount() > 0
    m.found.visible = not m.results.visible
    if not m.results.visible then m.found.text = "Nothing found for " + Chr(34) + m.asked + Chr(34) + "."
end sub

sub onPickResult()
    item = m.results.content.getChild(m.results.itemSelected)
    m.top.action = { go: "play", youtube: item.videoId, label: item.title }
end sub

' Right from the places goes into the place; left comes back (and left from the places opens
' Catalog's menu). Back leaves a channel or playlist first.
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "back" and m.opened.Count() > 0 then
        goBack()
        m.rows.setFocus(true)
        return true
    end if
    if key = "right" and m.places.isInFocusChain() then
        showPlace()
        goRight()
        return true
    end if
    if key = "right" and m.keyboard.isInFocusChain() and m.results.visible then
        m.results.setFocus(true)
        return true
    end if
    if key = "left" and m.results.isInFocusChain() then
        m.keyboard.setFocus(true)
        return true
    end if
    if key = "left" and (m.rows.isInFocusChain() or m.keyboard.isInFocusChain()) then
        m.places.setFocus(true)
        return true
    end if
    return false
end function

sub init()
    m.art = m.top.findNode("art")
    m.name = m.top.findNode("name")
    m.meta = m.top.findNode("meta")
    m.about = m.top.findNode("about")
    m.status = m.top.findNode("status")
    m.rows = m.top.findNode("rows")
    m.warm = m.top.findNode("warm")
    m.rows.observeField("rowItemSelected", "onPick")
    m.rows.observeField("rowItemFocused", "onHighlight")
    m.warm.observeField("fire", "warmUp")
    m.top.observeField("focusedChild", "onFocus")
    m.tiles = []
end sub

sub onFocus()
    if m.top.hasFocus() and m.rows.visible then m.rows.setFocus(true)
end sub

' Loaded when it opens, and again on coming back (Continue Watching has moved on).
sub start()
    api("/api/roku/rows", { screen: m.top.params.place }, "onRows")
end sub

sub onRows(event as Object)
    answer = event.getData()
    if not answer.ok then
        if answer.signIn then
            m.top.action = { go: "connect" }
            return
        end if
        m.status.text = "Catalog didn't answer. Is it open on the computer?"
        return
    end if
    focused = m.rows.rowItemFocused
    m.tiles = []
    content = CreateObject("roSGNode", "ContentNode")
    for each row in answer.data.rows
        node = content.createChild("ContentNode")
        node.title = row.label
        tiles = []
        for each tile in row.tiles
            progress = 0.0
            if tile.progress <> invalid then progress = tile.progress
            item = contentItem({ kind: "poster", note: text(tile.note), noteNew: tile.noteNew = true, progress: progress })
            item.title = tile.title
            if tile.poster <> invalid then item.hdPosterUrl = tile.poster
            node.appendChild(item)
            tiles.Push(tile)
        end for
        m.tiles.Push(tiles)
    end for
    if m.tiles.Count() = 0 then
        m.status.text = "Nothing here yet."
        m.rows.visible = false
        return
    end if
    m.rows.content = content
    m.rows.visible = true
    m.status.visible = false
    if focused <> invalid and focused.Count() = 2 and focused[0] < m.tiles.Count() and focused[1] < m.tiles[focused[0]].Count() then
        m.rows.jumpToRowItem = focused
    end if
    showBanner(m.tiles[0][0])
    if m.top.isInFocusChain() then m.rows.setFocus(true)
end sub

function focusedTile() as Dynamic
    at = m.rows.rowItemFocused
    if at = invalid or at.Count() < 2 or at[0] < 0 or at[0] >= m.tiles.Count() then return invalid
    row = m.tiles[at[0]]
    if at[1] < 0 or at[1] >= row.Count() then return invalid
    return row[at[1]]
end function

' The banner says what's highlighted: its name, what it is, what it's about, its picture.
sub showBanner(tile as Dynamic)
    if tile = invalid then return
    m.name.text = tile.title
    m.meta.text = text(tile.meta)
    m.about.text = text(tile.overview)
    nameSize = m.name.boundingRect()
    m.meta.translation = [20, 70 + nameSize.height + 8]
    m.about.translation = [20, 70 + nameSize.height + 50]
    m.art.uri = text(tile.big)
end sub

sub onHighlight()
    tile = focusedTile()
    showBanner(tile)
    ' Resting on Continue Watching: its video is started in the background.
    m.warm.control = "stop"
    if tile <> invalid and tile.warm <> invalid then m.warm.control = "start"
end sub

sub warmUp()
    tile = focusedTile()
    if tile = invalid or tile.warm = invalid then return
    query = { title: tile.warm.title, type: tile.warm.type, nostream: "1", warm: "1" }
    if tile.warm.season > 0 then
        query.resume_s = tile.warm.season
        query.resume_e = tile.warm.episode
    end if
    api("/api/watch/resolve", query, "onWarm")
end sub

sub onWarm()
end sub

sub onPick()
    tile = focusedTile()
    if tile <> invalid then m.top.action = actionFor(tile.go)
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "options" then
        tile = focusedTile()
        if tile <> invalid then showActions(tile.title, tile.actions)
        return true
    end if
    return false
end function

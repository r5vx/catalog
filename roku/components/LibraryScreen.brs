sub init()
    m.chips = m.top.findNode("chips")
    m.grid = m.top.findNode("grid")
    m.status = m.top.findNode("status")
    m.chips.observeField("itemSelected", "onChip")
    m.grid.observeField("itemSelected", "onPick")
    m.top.observeField("focusedChild", "onFocus")
    m.filters = [["", "All"], ["watching", "Watching"], ["planned", "Want to watch"], ["completed", "Watched"]]
    m.status_ = ""
    m.tiles = []
end sub

sub onFocus()
    if m.top.hasFocus() then m.chips.setFocus(true)
end sub

sub start()
    showChips()
    load()
end sub

sub showChips()
    content = CreateObject("roSGNode", "ContentNode")
    for each filter in m.filters
        item = contentItem({ kind: "chip", selected: filter[0] = m.status_ })
        item.title = filter[1]
        content.appendChild(item)
    end for
    at = m.chips.itemFocused
    m.chips.content = content
    if at > 0 then m.chips.jumpToItem = at
end sub

sub load()
    api("/api/roku/rows", { screen: "library", status: m.status_ }, "onRows")
end sub

sub onChip()
    m.status_ = m.filters[m.chips.itemSelected][0]
    showChips()
    load()
end sub

sub onRows(event as Object)
    answer = event.getData()
    if not answer.ok then
        m.status.text = "Catalog didn't answer. Is it open on the computer?"
        return
    end if
    m.tiles = []
    content = CreateObject("roSGNode", "ContentNode")
    for each row in answer.data.rows
        for each tile in row.tiles
            item = contentItem({ kind: "poster", note: text(tile.note), noteNew: tile.noteNew = true, progress: 0.0 })
            item.title = tile.title
            if tile.poster <> invalid then item.hdPosterUrl = tile.poster
            content.appendChild(item)
            m.tiles.Push(tile)
        end for
    end for
    m.grid.content = content
    m.grid.visible = m.tiles.Count() > 0
    m.status.visible = not m.grid.visible
    m.status.text = "Nothing here yet."
end sub

sub onPick()
    m.top.action = actionFor(m.tiles[m.grid.itemSelected].go)
end sub

' Down from the chips into the posters, up from the top row back to them; * offers its menu.
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "down" and m.chips.isInFocusChain() and m.grid.visible then
        m.grid.setFocus(true)
        return true
    else if key = "up" and m.grid.isInFocusChain() then
        m.chips.setFocus(true)
        return true
    else if key = "options" and m.grid.isInFocusChain() then
        tile = m.tiles[m.grid.itemFocused]
        showActions(tile.title, tile.actions)
        return true
    end if
    return false
end function

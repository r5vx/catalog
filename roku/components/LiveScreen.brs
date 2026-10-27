sub init()
    m.chips = m.top.findNode("chips")
    m.grid = m.top.findNode("grid")
    m.heading = m.top.findNode("heading")
    m.status = m.top.findNode("status")
    m.chips.observeField("itemSelected", "onChip")
    m.grid.observeField("itemSelected", "onPick")
    m.top.observeField("focusedChild", "onFocus")
    m.rows = []
    m.view = 0
end sub

sub onFocus()
    if m.top.hasFocus() then m.chips.setFocus(true)
end sub

sub start()
    api("/api/roku/live", {}, "onLive")
end sub

sub onLive(event as Object)
    answer = event.getData()
    if not answer.ok then
        m.status.text = "Live TV can't be reached right now."
        return
    end if
    ' The view picked stays picked when it's loaded again (after a game, or saving one).
    picked = ""
    if m.view < m.rows.Count() then picked = m.rows[m.view].label
    m.rows = answer.data.rows
    m.view = 0
    for i = 0 to m.rows.Count() - 1
        if m.rows[i].label = picked then m.view = i
    end for
    m.saved = {}
    for each row in m.rows
        if row.label = "Saved" then
            for each game in row.items
                m.saved[game.id] = true
            end for
        end if
    end for
    if m.rows.Count() = 0 then
        m.status.text = "No games on the schedule right now."
        return
    end if
    showChips()
    showView()
end sub

sub showChips()
    content = CreateObject("roSGNode", "ContentNode")
    for i = 0 to m.rows.Count() - 1
        item = contentItem({ kind: "chip", selected: i = m.view })
        item.title = m.rows[i].label
        content.appendChild(item)
    end for
    at = m.chips.itemFocused
    m.chips.content = content
    if at > 0 and at < m.rows.Count() then m.chips.jumpToItem = at
end sub

sub showView()
    row = m.rows[m.view]
    m.heading.text = row.label
    content = CreateObject("roSGNode", "ContentNode")
    ' Games carry a picture across the top (taller cards, two rows); channels are words only.
    if row.label = "Channels" then
        m.grid.itemSize = [540, 200]
        m.grid.numRows = 3
    else
        m.grid.itemSize = [540, 380]
        m.grid.numRows = 2
    end if
    for each game in row.items
        kind = "game"
        if row.label = "Channels" or game.isChannel = true then kind = "channel"
        fields = { kind: kind, onNow: game.on = true, progress: 0.0, sportName: text(game.sport), sportColor: text(game.sportColor), sportPicture: text(game.sportPicture), logoA: "", logoB: "", colorA: "", colorB: "" }
        if game.logos <> invalid and game.logos.Count() = 2 then
            fields.logoA = game.logos[0].logo
            fields.colorA = game.logos[0].color
            fields.logoB = game.logos[1].logo
            fields.colorB = game.logos[1].color
        end if
        item = contentItem(fields)
        item.title = game.label
        item.shortDescriptionLine1 = game.sub
        if game.poster <> invalid and game.poster <> "" then item.hdPosterUrl = game.poster
        content.appendChild(item)
    end for
    m.grid.content = content
    m.grid.visible = true
    m.status.visible = false
end sub

sub onChip()
    m.view = m.chips.itemSelected
    showChips()
    showView()
end sub

' OK plays: a channel, a replay, or a game on its best channel (one click, as on the Fire TV;
' the computer lists that one first). The * button on a game opens its other channels and Save.
sub onPick()
    row = m.rows[m.view]
    m.game = row.items[m.grid.itemSelected]
    if m.game.replay <> invalid and m.game.replay <> "" then
        m.top.action = { go: "play", replay: m.game.replay, label: m.game.label }
        return
    end if
    ' A game not on yet: its box (when it starts, its channels, Save), not what's on before it.
    if m.game.on <> true and m.game.isChannel <> true and row.label <> "Channels" and text(m.game.game) <> "" then
        openBox()
        return
    end if
    channel = m.game.channels[0]
    if channel = invalid then return
    label = m.game.label
    if row.label = "Channels" or m.game.isChannel = true then label = channel.name
    m.top.action = { go: "play", live: true, channel: channel.id, channelName: channel.name, game: m.game.game, label: label }
end sub

sub openBox()
    row = m.rows[m.view]
    if row.label = "Replays" or row.label = "Channels" or row.label = "Recently watched" then return
    m.game = row.items[m.grid.itemFocused]
    if m.game = invalid then return
    names = []
    m.channels = []
    for each channel in m.game.channels
        m.channels.Push(channel)
        names.Push("Watch on " + channel.name)
        if m.channels.Count() = 8 then exit for
    end for
    m.isSaved = m.saved.DoesExist(m.game.id)
    if m.isSaved then names.Push("★ Saved") else names.Push("☆ Save")
    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = m.game.label
    dialog.message = [m.game.sub]
    dialog.buttons = names
    dialog.observeField("buttonSelected", "onChoice")
    m.dialog = dialog
    m.top.getScene().dialog = dialog
end sub

sub onChoice()
    at = m.dialog.buttonSelected
    m.dialog.close = true
    if at < m.channels.Count() then
        channel = m.channels[at]
        m.top.action = { go: "play", live: true, channel: channel.id, channelName: channel.name, game: m.game.game, label: m.game.label }
    else
        api("/api/live/saved", {}, "onSaved", "POST", { kind: "game", id: m.game.game, saved: not m.isSaved })
    end if
end sub

sub onSaved()
    start()
end sub

' Down from the chips into the games, up from their top row back to the chips.
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "options" and m.grid.isInFocusChain() then
        openBox()
        return true
    else if key = "down" and m.chips.isInFocusChain() and m.grid.visible then
        m.grid.setFocus(true)
        return true
    else if key = "up" and m.grid.isInFocusChain() then
        m.chips.setFocus(true)
        return true
    end if
    return false
end function

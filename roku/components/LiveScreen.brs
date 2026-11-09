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
    ' A search (the first chip): what was typed, and what it found. m.view is -1 while it shows.
    m.searched = ""
    m.found = invalid
    ' The card a game was played from: back from the player, the highlight is on it again (-1: none).
    m.restore = -1
    m.restoreView = 0
end sub

sub onFocus()
    if not m.top.hasFocus() then return
    if m.restore >= 0 and m.grid.visible then m.grid.setFocus(true) else m.chips.setFocus(true)
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
    if m.view >= 0 and m.view < m.rows.Count() then picked = m.rows[m.view].label
    m.rows = answer.data.rows
    if m.view >= 0 then
        m.view = 0
        for i = 0 to m.rows.Count() - 1
            if m.rows[i].label = picked then m.view = i
        end for
    else
        m.found = searchRows(m.searched)
    end if
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
    ' First: Search (what was searched for, once there is something).
    find = contentItem({ kind: "chip", selected: m.view = -1 })
    find.title = "Search"
    if m.searched <> "" then find.title = Chr(34) + m.searched + Chr(34)
    content.appendChild(find)
    for i = 0 to m.rows.Count() - 1
        item = contentItem({ kind: "chip", selected: i = m.view })
        item.title = m.rows[i].label
        content.appendChild(item)
    end for
    at = m.chips.itemFocused
    m.chips.content = content
    if at > 0 and at <= m.rows.Count() then m.chips.jumpToItem = at
end sub

' The view showing: one of the rows, or what a search found.
function currentRow() as Object
    if m.view = -1 and m.found <> invalid then return m.found
    return m.rows[m.view]
end function

sub showView()
    row = currentRow()
    m.heading.text = row.label
    if row.items.Count() = 0 then
        m.grid.visible = false
        m.status.visible = true
        m.status.text = "Nothing on Live TV matches " + Chr(34) + m.searched + Chr(34) + "."
        return
    end if
    content = CreateObject("roSGNode", "ContentNode")
    ' Games carry a picture across the top (taller cards, two rows); channels are words only.
    if row.label = "Channels" then
        m.grid.itemSize = [568, 228]
        m.grid.numRows = 3
    else
        m.grid.itemSize = [568, 408]
        m.grid.numRows = 2
    end if
    for each game in row.items
        kind = "game"
        if row.label = "Channels" or game.isChannel = true then kind = "channel"
        fields = { pad: 14, kind: kind, onNow: game.on = true, progress: 0.0, sportName: text(game.sport), sportColor: text(game.sportColor), sportPicture: text(game.sportPicture), logoA: "", logoB: "", colorA: "", colorB: "" }
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
    ' Come back from a game: the same card highlighted, in the same view.
    if m.restore >= 0 and m.view = m.restoreView and m.restore < row.items.Count() then
        m.grid.jumpToItem = m.restore
        if m.top.isInFocusChain() then m.grid.setFocus(true)
    end if
end sub

sub onChip()
    if m.chips.itemSelected = 0 then
        askSearch()
        return
    end if
    m.view = m.chips.itemSelected - 1
    showChips()
    showView()
end sub

' Search: the Roku's keyboard, then every game, channel and replay whose name has those words
' (a team, a league, a channel), from every view at once.
sub askSearch()
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.title = "Search Live TV"
    dialog.message = ["A team, a league or a channel"]
    dialog.text = m.searched
    dialog.buttons = ["Search", "Cancel"]
    dialog.observeField("buttonSelected", "onSearch")
    m.keyboard = dialog
    m.top.getScene().dialog = dialog
end sub

sub onSearch()
    words = m.keyboard.text.Trim()
    picked = m.keyboard.buttonSelected
    m.keyboard.close = true
    if picked <> 0 then return
    m.searched = words
    if words = "" then
        m.found = invalid
        if m.view = -1 then m.view = 0
    else
        m.found = searchRows(words)
        m.view = -1
    end if
    showChips()
    showView()
    if m.grid.visible then m.grid.setFocus(true)
end sub

' A view of everything matching `words` (each word somewhere in its name, its line under, or its
' channels' names), each game once.
function searchRows(words as String) as Object
    wanted = []
    for each word in LCase(words).Split(" ")
        if word <> "" then wanted.Push(word)
    end for
    items = []
    seen = {}
    for each row in m.rows
        if row.label <> "Recently watched" then
            for each item in row.items
                about = LCase(text(item.label) + " " + text(item.sub))
                if item.channels <> invalid then
                    for each channel in item.channels
                        about = about + " " + LCase(text(channel.name))
                    end for
                end if
                matches = true
                for each word in wanted
                    if Instr(1, about, word) = 0 then matches = false
                end for
                key = text(item.label) + "|" + text(item.sub)
                if matches and not seen.DoesExist(key) then
                    seen[key] = true
                    ' A channel from the Channels view stays a channel (OK plays it straight away).
                    if row.label = "Channels" then
                        copy = {}
                        copy.Append(item)
                        copy.isChannel = true
                        item = copy
                    end if
                    items.Push(item)
                end if
            end for
        end if
    end for
    return { label: "Search: " + words, items: items }
end function

' OK plays: a channel, a replay, or a game on its best channel (one click, as on the Fire TV;
' the computer lists that one first). The * button on a game opens its other channels and Save.
sub onPick()
    row = currentRow()
    m.restore = m.grid.itemSelected
    m.restoreView = m.view
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
    row = currentRow()
    if row.label = "Recently watched" then
        openForgetBox()
        return
    end if
    if row.label = "Replays" or row.label = "Channels" then return
    m.game = row.items[m.grid.itemFocused]
    if m.game = invalid then return
    ' (A channel or a replay among a search's finds has no box either.)
    if m.game.isChannel = true or text(m.game.replay) <> "" or m.game.channels = invalid then return
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

' * on Recently watched: take that channel or replay off it, or clear it all (as the Fire TV).
sub openForgetBox()
    row = currentRow()
    m.game = row.items[m.grid.itemFocused]
    if m.game = invalid then return
    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = m.game.label
    dialog.message = [m.game.sub]
    dialog.buttons = ["Remove from Recently watched", "Clear Recently watched"]
    dialog.observeField("buttonSelected", "onForget")
    m.dialog = dialog
    m.top.getScene().dialog = dialog
end sub

sub onForget()
    at = m.dialog.buttonSelected
    m.dialog.close = true
    if at = 1 then
        body = { remove: "all" }
    else if m.game.replay <> invalid and m.game.replay <> "" then
        body = { remove: true, replay: m.game.replay }
    else
        body = { remove: true, id: m.game.channels[0].id }
    end if
    api("/api/live/watched", {}, "onSaved", "POST", body)
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
        m.restore = -1
        m.chips.setFocus(true)
        return true
    end if
    return false
end function

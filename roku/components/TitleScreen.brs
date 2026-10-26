sub init()
    m.art = m.top.findNode("art")
    m.name = m.top.findNode("name")
    m.info = m.top.findNode("info")
    m.facts = m.top.findNode("facts")
    m.barBack = m.top.findNode("barBack")
    m.bar = m.top.findNode("bar")
    m.leftLabel = m.top.findNode("left")
    m.about = m.top.findNode("about")
    m.status = m.top.findNode("status")
    m.rows = m.top.findNode("rows")
    m.warm = m.top.findNode("warm")
    m.rows.observeField("rowItemSelected", "onPick")
    m.rows.observeField("rowItemFocused", "onHighlight")
    m.warm.observeField("fire", "warmUp")
    m.top.observeField("focusedChild", "onFocus")
    m.title = invalid
    m.seasonData = invalid
    m.more = []
    m.inList = false
end sub

sub onFocus()
    if m.top.hasFocus() and m.rows.visible then m.rows.setFocus(true)
end sub

' Opened, or come back to (where it was left has moved on).
sub start()
    params = m.top.params
    if m.title = invalid then m.name.text = text(params.label)
    api("/api/roku/title", { source: params.source, id: params.sourceId }, "onTitle")
end sub

sub onTitle(event as Object)
    answer = event.getData()
    if not answer.ok then
        m.status.text = "Catalog couldn't find that just now."
        return
    end if
    first = m.title = invalid
    m.title = answer.data
    title = m.title
    m.inList = title.inList = true
    m.name.text = title.title
    m.facts.text = title.facts
    m.about.text = text(title.overview)
    if title.backdrop <> invalid then
        m.art.uri = title.backdrop
    else if title.big <> invalid then
        m.art.uri = title.big
    end if
    m.status.text = ""

    ' Under the name: the facts, how far through (and minutes left), what it's about.
    nameSize = m.name.boundingRect()
    y = 90 + nameSize.height + 10
    m.facts.translation = [96, y]
    y = y + 50
    going = title.continuing
    showBar = going <> invalid and going.progress > 0
    m.barBack.visible = showBar
    m.bar.visible = showBar
    m.leftLabel.visible = showBar and going.left <> invalid
    if showBar then
        m.barBack.translation = [96, y + 14]
        progress = going.progress
        if progress < 0.03 then progress = 0.03
        m.bar.width = 300 * progress
        m.bar.translation = [96, y + 14]
        if going.left <> invalid then
            m.leftLabel.text = text(going.left) + " min left"
            m.leftLabel.translation = [420, y]
        end if
        y = y + 50
    end if
    m.about.translation = [96, y]

    if first and title.type = "tv" and title.seasons.Count() > 0 then
        loadSeason(title.season)
    else if title.type = "tv" and m.seasonData <> invalid then
        loadSeason(m.seasonData.season)
    end if
    if first then
        api("/api/recommendations", { source: title.source, id: title.id, title: title.title }, "onMore")
    end if
    build()
end sub

sub loadSeason(season as Integer)
    api("/api/roku/season", { source: m.title.source, id: m.title.id, title: m.title.playTitle, year: m.title.playYear, season: season }, "onSeason")
end sub

sub onSeason(event as Object)
    answer = event.getData()
    if not answer.ok then return
    m.seasonData = answer.data
    build()
end sub

sub onMore(event as Object)
    answer = event.getData()
    if not answer.ok then return
    m.more = []
    for each one in answer.data
        if one.more <> true then m.more.Push(one)
    end for
    build()
end sub

' The rows: the buttons; a show's seasons (more than one) and episodes; More like this.
sub build()
    title = m.title
    if title = invalid then return
    focused = m.rows.rowItemFocused
    m.kinds = []
    m.items = []
    content = CreateObject("roSGNode", "ContentNode")
    sizes = []
    heights = []
    labels = []

    ' The buttons.
    buttons = []
    if title.unreleased = true then
        buttons.Push({ label: "Not out yet", act: "" })
    else
        buttons.Push({ label: "▶  " + title.playLabel, act: "play", primary: true })
        if title.continuing <> invalid and title.type = "tv" then buttons.Push({ label: "From the start", act: "start" })
    end if
    if m.inList then buttons.Push({ label: "✓ My List", act: "" }) else buttons.Push({ label: "+ My List", act: "list" })
    addRow(content, "buttons", "", buttons, sizes, heights, labels, [380, 80], 120)

    if m.seasonData <> invalid then
        seasons = m.seasonData.seasons
        if seasons.Count() > 1 then
            chips = []
            for each one in seasons
                chips.Push({ label: "Season " + text(one.number), act: "season", season: one.number })
            end for
            addRow(content, "seasons", "", chips, sizes, heights, labels, [220, 64], 100)
        end if
        if m.seasonData.episodes.Count() > 0 then addRow(content, "episodes", "Episodes", m.seasonData.episodes, sizes, heights, labels, [400, 330], 410)
    end if
    if m.more.Count() > 0 then addRow(content, "more", "More like this", m.more, sizes, heights, labels, [180, 270], 350)

    m.rows.rowItemSize = sizes
    m.rows.rowHeights = heights
    m.rows.showRowLabel = labels
    m.rows.content = content
    m.rows.visible = true
    if focused <> invalid and focused.Count() = 2 and focused[0] < m.kinds.Count() and focused[1] < m.items[focused[0]].Count() then
        m.rows.jumpToRowItem = focused
    end if
    if m.top.isInFocusChain() then m.rows.setFocus(true)
end sub

sub addRow(content as Object, kind as String, label as String, list as Object, sizes as Object, heights as Object, labels as Object, size as Object, height as Integer)
    row = content.createChild("ContentNode")
    row.title = label
    for each one in list
        if kind = "buttons" then
            item = contentItem({ kind: "button", primary: one.primary = true, progress: 0.0 })
            item.title = one.label
        else if kind = "seasons" then
            item = contentItem({ kind: "chip", selected: one.season = m.seasonData.season, progress: 0.0 })
            item.title = one.label
        else if kind = "episodes" then
            progress = 0.0
            if one.progress <> invalid then progress = one.progress
            line = ""
            if one.available <> true then
                line = "Not available"
                if one.airDate <> invalid then line = "Out " + text(one.airDate)
            else if one.runtime <> invalid then
                line = text(one.runtime) + "m"
            end if
            item = contentItem({ kind: "episode", under: text(one.episode) + ". " + text(one.name), progress: progress })
            item.title = text(one.name)
            item.shortDescriptionLine1 = line
            if one.still <> invalid then item.hdPosterUrl = one.still
        else
            note = ""
            if one.watched = true then
                note = "Watched"
            else if one.watching = true then
                note = "Watching"
            end if
            item = contentItem({ kind: "poster", note: note, progress: 0.0 })
            item.title = one.title
            if one.posterUrl <> invalid then item.hdPosterUrl = one.posterUrl
        end if
        row.appendChild(item)
    end for
    m.kinds.Push(kind)
    m.items.Push(list)
    sizes.Push(size)
    heights.Push(height)
    labels.Push(label <> "")
end sub

' Down into the seasons and episodes: they slide up under the name, as on the Fire TV.
sub onHighlight()
    at = m.rows.rowItemFocused
    if at = invalid or at.Count() < 2 or m.kinds = invalid or at[0] >= m.kinds.Count() then return
    down = at[0] > 0
    m.info.visible = not down
    if down then m.rows.translation = [96, 220] else m.rows.translation = [96, 560]
    m.warm.control = "stop"
    kind = m.kinds[at[0]]
    if (kind = "buttons" and at[1] = 0) or kind = "episodes" then m.warm.control = "start"
end sub

' Resting on Play or an episode: its video is started in the background (as on the Fire TV).
sub warmUp()
    at = m.rows.rowItemFocused
    choice = playChoice(at[0], at[1])
    if choice = invalid then return
    query = { title: choice.title, type: choice.type, nostream: "1", warm: "1" }
    if choice.year <> "" then query.year = choice.year
    if choice.season > 0 then
        query.resume_s = choice.season
        query.resume_e = choice.episode
    end if
    api("/api/watch/resolve", query, "onWarm")
end sub

sub onWarm()
end sub

' What a button or an episode plays, or invalid.
function playChoice(row as Integer, column as Integer) as Dynamic
    title = m.title
    kind = m.kinds[row]
    if kind = "buttons" then
        act = m.items[row][column].act
        if act = "play" then
            season = 0
            episode = 0
            if title.continuing <> invalid then
                season = title.continuing.season
                episode = title.continuing.episode
            end if
            return { title: title.playTitle, type: title.type, year: title.playYear, season: season, episode: episode }
        else if act = "start" then
            return { title: title.playTitle, type: title.type, year: "", season: 1, episode: 1 }
        end if
    else if kind = "episodes" then
        one = m.items[row][column]
        if one.available <> true then return invalid
        year = ""
        if title.continuing = invalid then year = title.playYear
        return { title: m.seasonData.title, type: "tv", year: year, season: m.seasonData.season, episode: one.episode }
    end if
    return invalid
end function

sub onPick()
    at = m.rows.rowItemSelected
    kind = m.kinds[at[0]]
    one = m.items[at[0]][at[1]]
    if kind = "seasons" then
        loadSeason(one.season)
        return
    else if kind = "more" then
        m.top.action = { go: "title", source: one.source, sourceId: one.sourceId, label: one.title }
        return
    else if kind = "buttons" and one.act = "list" then
        m.inList = true
        build()
        api("/api/add", {}, "onWarm", "POST", { source: m.title.source, sourceId: m.title.id, status: "planned" })
        return
    end if
    choice = playChoice(at[0], at[1])
    if choice = invalid then return
    m.top.action = { go: "play", title: choice.title, type: choice.type, year: choice.year, season: choice.season, episode: choice.episode }
end sub

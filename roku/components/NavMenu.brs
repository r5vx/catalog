sub init()
    m.items = m.top.findNode("items")
    m.backing = m.top.findNode("backing")
    m.dim = m.top.findNode("dim")
    m.at = 2
    build()
    m.top.observeField("focusedChild", "onFocus")
end sub

' Opening, it starts on the place you're on (as the Fire TV's does).
sub onFocus()
    open = m.top.hasFocus()
    if open and not m.top.open then
        list = places()
        for i = 0 to list.Count() - 1
            if list[i].place = m.top.current then m.at = i
        end for
    end if
    m.top.open = open
end sub

' The places, in the Fire TV's order (the first: who's watching, its initial on their color).
function places() as Object
    return [
        { place: "profiles", label: m.top.who, icon: "" },
        { place: "search", label: "Search", icon: "search" },
        { place: "home", label: "Home", icon: "home" },
        { place: "movies", label: "Movies", icon: "movie" },
        { place: "tv", label: "TV Shows", icon: "tv" },
        { place: "anime", label: "Anime", icon: "anime" },
        { place: "library", label: "My Library", icon: "library" },
        { place: "live", label: "Live TV", icon: "live" },
        { place: "settings", label: "Settings", icon: "settings" }
    ]
end function

sub build()
    m.items.removeChildrenIndex(m.items.getChildCount(), 0)
    y = 0
    for each one in places()
        row = m.items.createChild("Group")
        row.translation = [0, y]
        back = row.createChild("Poster")
        back.uri = "pkg:/images/pill.9.png"
        back.width = 400
        back.height = 76
        back.translation = [-12, -14]
        back.visible = false
        if one.icon = "" then
            ' Who's watching: their initial on their color.
            face = row.createChild("Rectangle")
            face.width = 48
            face.height = 48
            face.color = "0xE994C2FF"
            if m.top.whoColor <> "" then face.color = m.top.whoColor
            initial = row.createChild("Label")
            initial.width = 48
            initial.height = 48
            initial.horizAlign = "center"
            initial.vertAlign = "center"
            initial.font = "font:MediumBoldSystemFont"
            initial.color = "0x1A1A1AFF"
            name = one.label
            if name = "" then name = "Me"
            initial.text = UCase(Left(name, 1))
        else
            icon = row.createChild("Poster")
            icon.uri = "pkg:/images/nav_" + one.icon + ".png"
            icon.width = 48
            icon.height = 48
            icon.id = "icon"
        end if
        label = row.createChild("Label")
        label.text = one.label
        if one.icon = "" and one.label = "" then label.text = "Who's watching"
        label.translation = [76, 4]
        label.font = "font:MediumBoldSystemFont"
        label.id = "label"
        y = y + 96
    end for
    paint()
end sub

' Open or narrow; the place you're on in the accent color; the highlighted one white.
sub paint()
    open = m.top.open
    if open then
        m.backing.uri = "pkg:/images/nav_open.png"
        m.backing.width = 600
    else
        m.backing.uri = "pkg:/images/nav_closed.png"
        m.backing.width = 160
    end if
    m.dim.visible = open
    list = places()
    for i = 0 to m.items.getChildCount() - 1
        row = m.items.getChild(i)
        back = row.getChild(0)
        label = row.findNode("label")
        icon = row.findNode("icon")
        highlighted = open and i = m.at
        color = "0xA3B0A8FF"
        if list[i].place = m.top.current then color = "0xD97A83FF"
        if highlighted then color = "0x111614FF"
        back.visible = highlighted
        back.blendColor = "0xE7EDE9FF"
        if label <> invalid then
            label.visible = open
            label.color = color
        end if
        if icon <> invalid then icon.blendColor = color
    end for
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    count = m.items.getChildCount()
    if key = "down" and m.at < count - 1 then
        m.at = m.at + 1
        paint()
        return true
    else if key = "up" and m.at > 0 then
        m.at = m.at - 1
        paint()
        return true
    else if key = "OK" then
        m.top.chosen = places()[m.at].place
        return true
    end if
    return false
end function

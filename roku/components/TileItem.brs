' Colors, as Catalog's dark theme (src/app.css).
function colors() as Object
    return { ink: "0xE7EDE9FF", soft: "0xA3B0A8FF", faint: "0x75837BFF", paper: "0x111614FF", surface: "0x1F2724FF", accent: "0xD97A83FF" }
end function

sub init()
    m.body = m.top.findNode("body")
    m.back = m.top.findNode("back")
    m.picture = m.top.findNode("picture")
    m.name = m.top.findNode("name")
    m.sub = m.top.findNode("sub")
    m.dot = m.top.findNode("dot")
    m.noteBack = m.top.findNode("noteBack")
    m.note = m.top.findNode("note")
    m.barBack = m.top.findNode("barBack")
    m.bar = m.top.findNode("bar")
    m.ring = m.top.findNode("ring")
    m.under = m.top.findNode("under")
    m.artBack = m.top.findNode("artBack")
    m.glowA = m.top.findNode("glowA")
    m.glowB = m.top.findNode("glowB")
    m.logoA = m.top.findNode("logoA")
    m.logoB = m.top.findNode("logoB")
    m.artLabel = m.top.findNode("artLabel")
    m.focused = false
end sub

function kind() as String
    item = m.top.itemContent
    if item = invalid or item.kind = invalid then return "poster"
    return item.kind
end function

sub show()
    item = m.top.itemContent
    if item = invalid then return
    m.name.text = item.title
    m.sub.text = item.shortDescriptionLine1
    m.picture.uri = item.hdPosterUrl
    m.note.text = text(item.note)
    m.under.text = text(item.under)
    layout()
end sub

sub layout()
    width = m.top.width
    height = m.top.height
    if width = 0 or height = 0 then return
    item = m.top.itemContent
    if item = invalid then return
    c = colors()
    k = kind()
    hasPicture = item.hdPosterUrl <> invalid and item.hdPosterUrl <> ""
    m.picture.visible = false
    m.name.visible = false
    m.sub.visible = false
    m.dot.visible = false
    m.note.visible = false
    m.noteBack.visible = false
    m.under.visible = false
    m.barBack.visible = false
    m.bar.visible = false
    m.artBack.visible = false
    m.glowA.visible = false
    m.glowB.visible = false
    m.logoA.visible = false
    m.logoB.visible = false
    m.artLabel.visible = false
    m.back.blendColor = c.surface
    m.name.horizAlign = "left"
    m.name.vertAlign = "top"
    m.name.color = c.ink
    m.body.scaleRotateCenter = [width / 2, height / 2]
    boxHeight = height
    m.ring.translation = [-6, -6]

    if k = "chip" or k = "button" then
        ' A pill with words in the middle (the picked chip in the accent color).
        m.back.uri = "pkg:/images/pill.9.png"
        m.back.width = width
        m.back.height = height
        m.name.visible = true
        m.name.horizAlign = "center"
        m.name.vertAlign = "center"
        m.name.maxLines = 1
        m.name.width = width - 24
        m.name.height = height
        m.name.translation = [12, 0]
        showFocus()
        return
    end if

    m.back.uri = "pkg:/images/card.9.png"
    if k = "episode" then
        ' The episode's picture, then its number and name, and how long, under it.
        boxHeight = Int(width * 9 / 16)
        m.under.visible = true
        m.under.width = width
        m.under.translation = [0, boxHeight + 12]
        m.sub.visible = true
        m.sub.width = width
        m.sub.translation = [0, boxHeight + 70]
        m.sub.color = c.faint
    else if k = "profile" then
        boxHeight = width
        m.back.blendColor = text(item.color)
        m.name.visible = true
        m.name.font = "font:LargeBoldSystemFont"
        m.name.text = UCase(Left(item.title, 1))
        m.name.color = c.paper
        m.name.horizAlign = "center"
        m.name.vertAlign = "center"
        m.name.width = width
        m.name.height = boxHeight
        m.name.translation = [0, 0]
        m.under.visible = true
        m.under.horizAlign = "center"
        m.under.width = width
        m.under.translation = [0, boxHeight + 14]
    else if k = "game" or k = "channel" then
        ' A card: a red dot when it's on now, the name, then when and the league at the bottom.
        m.name.visible = true
        m.sub.visible = true
        left = 22
        top = 18
        if k = "game" and item.sportName <> invalid then
            top = showGameArt(item, width, width / 2) + 14
        end if
        if item.onNow = true then
            m.dot.visible = true
            m.dot.translation = [22, top + 12]
            left = 48
        end if
        m.name.translation = [left, top]
        m.name.width = width - left - 20
        m.name.maxLines = 2
        m.sub.translation = [22, height - 70]
        ' Under a picture: the name on one line, when and the league just below it.
        if top > 18 then
            m.name.maxLines = 1
            m.sub.translation = [22, top + 46]
        end if
        m.sub.width = width - 44
        m.sub.color = c.soft
        if item.onNow = true then m.sub.color = c.accent
    else
        ' A poster; its name in the middle when there's no picture.
        if not hasPicture then
            m.name.visible = true
            m.name.horizAlign = "center"
            m.name.vertAlign = "center"
            m.name.width = width - 24
            m.name.height = height - 24
            m.name.translation = [12, 12]
        end if
        if m.note.text <> "" then
            m.note.visible = true
            m.noteBack.visible = true
            size = m.note.boundingRect()
            m.noteBack.width = size.width + 20
            m.noteBack.height = 34
            m.noteBack.translation = [10, height - 52]
            m.note.translation = [20, height - 49]
            m.noteBack.blendColor = "0x000000CC"
            if item.noteNew = true then m.noteBack.blendColor = c.accent
        end if
    end if

    m.back.width = width
    m.back.height = boxHeight
    m.picture.visible = hasPicture
    m.picture.width = width
    m.picture.height = boxHeight
    m.ring.width = width + 12
    m.ring.height = boxHeight + 12

    ' How far through it you are, along the bottom of the picture.
    progress = 0
    if item.progress <> invalid then progress = item.progress
    if progress > 0 then
        m.barBack.visible = true
        m.bar.visible = true
        m.barBack.width = width
        m.barBack.height = 8
        m.barBack.translation = [0, boxHeight - 8]
        if progress < 0.04 then progress = 0.04
        if progress > 1 then progress = 1
        m.bar.width = width * progress
        m.bar.height = 8
        m.bar.translation = [0, boxHeight - 8]
    end if
    showFocus()
end sub

' Highlighted: a white ring and a little bigger (a chip or a button fills white, as on the Fire TV).
sub showFocus()
    item = m.top.itemContent
    if item = invalid then return
    focused = m.top.focusPercent > 0.5 and (m.top.gridHasFocus or (m.top.rowListHasFocus and m.top.rowFocusPercent > 0.5))
    c = colors()
    k = kind()
    if k = "chip" or k = "button" then
        if focused then
            m.back.blendColor = c.ink
            m.name.color = c.paper
        else if item.selected = true then
            m.back.blendColor = "0xD97A8333"
            m.name.color = c.accent
        else if k = "button" and item.primary = true then
            m.back.blendColor = "0xFFFFFF33"
            m.name.color = c.ink
        else
            m.back.blendColor = "0xFFFFFF1A"
            m.name.color = c.soft
        end if
        return
    end if
    m.ring.visible = focused
    if focused then
        m.body.scale = [1.06, 1.06]
    else
        m.body.scale = [1, 1]
    end if
end sub

' A live game's picture, `height` tall across the top: a replay's own picture; else each team's
' logo on its color (left and right); else the sport's color with its name. Returns its height.
function showGameArt(item as Object, wide as Dynamic, tall as Dynamic) as Integer
    width = Int(wide)
    height = Int(tall)
    m.artBack.visible = true
    m.artBack.color = "0x0E1013FF"
    m.artBack.width = width
    m.artBack.height = height
    if item.hdPosterUrl <> invalid and item.hdPosterUrl <> "" then
        m.artBack.visible = false
        m.picture.visible = true
        m.picture.width = width
        m.picture.height = height
        return height
    end if
    half = Int(width / 2)
    if item.logoA <> invalid and item.logoA <> "" then
        m.glowA.visible = true
        m.glowA.color = rokuColor(item.colorA, "99")
        m.glowA.width = half
        m.glowA.height = height
        m.glowB.visible = true
        m.glowB.color = rokuColor(item.colorB, "99")
        m.glowB.width = width - half
        m.glowB.height = height
        m.glowB.translation = [half, 0]
        size = Int(height * 0.62)
        m.logoA.visible = true
        m.logoA.uri = item.logoA
        m.logoA.width = size
        m.logoA.height = size
        m.logoA.translation = [Int((half - size) / 2), Int((height - size) / 2)]
        m.logoB.visible = true
        m.logoB.uri = item.logoB
        m.logoB.width = size
        m.logoB.height = size
        m.logoB.translation = [half + Int((width - half - size) / 2), Int((height - size) / 2)]
        return height
    end if
    ' No logos: a photo of the sport (the computer's /sports/), else its color and name.
    if item.sportPicture <> invalid and item.sportPicture <> "" then
        m.artBack.visible = false
        m.picture.visible = true
        m.picture.uri = item.sportPicture
        m.picture.width = width
        m.picture.height = height
        return height
    end if
    m.artBack.color = rokuColor(item.sportColor, "FF")
    m.artLabel.visible = true
    m.artLabel.text = UCase(text(item.sportName))
    m.artLabel.width = width
    m.artLabel.height = height
    return height
end function

' "#a40227" as Roku writes colors ("0xA40227" and `alpha`).
function rokuColor(hex as Dynamic, alpha as String) as String
    if hex = invalid or Len(hex) < 7 then return "0x444444" + alpha
    return "0x" + UCase(Mid(hex, 2, 6)) + alpha
end function

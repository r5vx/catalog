sub init()
    m.video = m.top.findNode("video")
    ' Secure (https) video addresses, as Showbox's are: checked against the Roku's own list of
    ' certificates.
    m.video.setCertificatesFile("common:/certs/ca-bundle.crt")
    m.video.initClientCertificates()
    m.waiting = m.top.findNode("waiting")
    m.message = m.top.findNode("message")
    m.spinner = m.top.findNode("spinner")
    m.spinner.poster.uri = "pkg:/images/spinner.png"
    m.skipButton = m.top.findNode("skip")
    m.skipLabel = m.top.findNode("skipLabel")
    m.saver = m.top.findNode("saver")
    m.saver.observeField("fire", "saveProgress")
    m.video.observeField("state", "onState")
    m.video.observeField("position", "onPosition")
    m.plan = invalid
    m.live = invalid
    m.youtube = invalid
    m.captionsBefore = invalid
    m.skips = []
    m.skipped = {}
    m.showing = invalid
    m.retried = false
    m.retryAt = 0

    ' Captions, drawn here (/api/roku/captions).
    m.captionGroup = m.top.findNode("captions")
    m.capBox = m.top.findNode("capBox")
    m.capText = m.top.findNode("capText")
    m.capShadow = m.top.findNode("capShadow")
    m.cueTimer = m.top.findNode("cueTimer")
    m.cueTimer.observeField("fire", "showCue")
    m.capPoll = m.top.findNode("capPoll")
    m.capPoll.observeField("fire", "loadCaptions")
    m.note = m.top.findNode("note")
    m.noteBack = m.top.findNode("noteBack")
    m.noteText = m.top.findNode("noteText")
    m.noteTimer = m.top.findNode("noteTimer")
    m.noteTimer.observeField("fire", "hideNote")
    m.cues = []
    m.cueAt = 0
    m.capOptions = []
    m.capPicked = -1
    m.capOff = not m.global.captions
    m.capTiming = { state: "off" }
    m.capHand = 0.0
    m.capWaitingBefore = false
    styleCaptions()

    ' The player's menu (Down or *).
    m.menu = m.top.findNode("menu")
    m.menuTitle = m.top.findNode("menuTitle")
    m.menuList = m.top.findNode("menuList")
    m.menuHint = m.top.findNode("menuHint")
    m.menuList.observeField("itemSelected", "onMenuPick")
    m.menuLevel = ""
    m.lastLevel = ""
    m.menuActs = []
    m.wantCopy = invalid
end sub

sub start()
    params = m.top.params
    if params.live = true then
        playLive(params)
    else if text(params.replay) <> "" then
        playReplay(params)
    else if text(params.youtube) <> "" then
        playYouTube(params)
    else
        load(text(params.title), text(params.type), text(params.year), number(params.season), number(params.episode), params.fromStart = true)
    end if
end sub

sub showWaiting(words as String)
    m.waiting.visible = true
    ' Only one loading circle: not ours while the Roku's player shows its own (it's loading or
    ' playing something already).
    state = m.video.state
    videoBusy = state = "buffering" or state = "playing" or state = "paused"
    m.spinner.visible = Right(words, 1) = "…" and not videoBusy
    m.message.text = words
end sub

' Asks Catalog what to play: the copy, its address, and where to start (/api/roku/play).
sub load(title as String, kind as String, year as String, season as Integer, episode as Integer, fromStart as Boolean)
    m.fromStart = fromStart
    m.video.control = "stop"
    m.skips = []
    m.skipped = {}
    hideSkip()
    if season > 0 then
        showWaiting("Loading S" + season.ToStr() + " E" + episode.ToStr() + "…")
    else
        showWaiting("Loading…")
    end if
    m.asking = { title: title, type: kind, year: year, season: season, episode: episode }
    ' A source picked in the menu, for this episode or film only.
    if m.wantCopy <> invalid then
        m.asking.fid = text(m.wantCopy.fid)
        m.asking.copy = text(m.wantCopy.copy)
    end if
    clearCaptions()
    api("/api/roku/play", m.asking, "onPlan")
end sub

sub onPlan(event as Object)
    answer = event.getData()
    if not answer.ok or answer.data.error <> invalid then
        problem = "That can't be played right now."
        if answer.ok then problem = answer.data.error
        showWaiting(problem)
        return
    end if
    plan = answer.data
    m.plan = plan
    m.wantCopy = invalid
    content = CreateObject("roSGNode", "ContentNode")
    content.url = plan.url
    content.streamFormat = plan.format
    content.httpHeaders = videoHeaders(plan.headers)
    ' Only the top quality, never lower by itself (as on the computer and Fire TV).
    if plan.minBandwidth <> invalid and plan.minBandwidth > 0 then content.MinBandwidth = plan.minBandwidth
    name = plan.title
    if plan.type = "tv" then
        name = name + "  ·  S" + text(plan.season) + " E" + text(plan.episode)
        if plan.episodeName <> "" then name = name + "  ·  " + plan.episodeName
    end if
    content.title = name
    ' Preview pictures while fast-forwarding and rewinding: the computer's (/api/roku/bif).
    if plan.bif <> invalid then
        content.HDBifUrl = plan.bif
        content.SDBifUrl = plan.bif
        content.FHDBifUrl = plan.bif
    end if
    ' Where to start: where it was left (or, after a fresh link, where it stopped working).
    if m.retryAt > 0 then
        content.playStart = m.retryAt
        m.retryAt = 0
    else if not m.fromStart and plan.start > 0 then
        content.playStart = plan.start
    end if
    m.japanese = plan.anime = true
    m.played = false
    m.audioPicked = false
    m.skipsAsked = false
    m.video.content = content
    ' Captions are drawn here, not by the Roku (its own were in capitals, in its own style).
    if m.captionsBefore = invalid then m.captionsBefore = m.video.globalCaptionMode
    m.video.globalCaptionMode = "Off"
    m.video.control = "play"
    m.video.setFocus(true)
    m.saver.control = "start"
    ' English captions: on, as everything starts on a TV (Settings turns that off), and always for
    ' anime in Japanese.
    if m.japanese then m.capOff = false
    if not m.capOff and plan.subtitles <> invalid then loadCaptions()
end sub

' ---------------------------------------------------------------- captions

' Their size and look, from Settings (and the menu).
sub styleCaptions()
    sizes = { small: 38, medium: 48, large: 58, huge: 70 }
    size = sizes[text(m.global.captionSize)]
    if size = invalid then size = 48
    for each label in [m.capText, m.capShadow]
        font = CreateObject("roSGNode", "Font")
        font.uri = "font:BoldSystemFontFile"
        font.size = size
        label.font = font
    end for
    m.capShadow.visible = not m.global.captionBox
    m.capBox.visible = false
end sub

sub clearCaptions()
    m.cues = []
    m.cueAt = 0
    m.capOptions = []
    m.capTiming = { state: "off" }
    m.capHand = 0.0
    m.capPoll.control = "stop"
    m.cueTimer.control = "stop"
    m.captionGroup.visible = false
end sub

' The captions for what's playing, timed by the computer (/api/roku/captions).
sub loadCaptions()
    plan = m.plan
    if plan = invalid or m.capOff then return
    query = { title: plan.title, type: plan.type, year: text(plan.year), season: text(plan.season), episode: text(plan.episode), copy: text(plan.copy), from: Int(m.video.position).ToStr() }
    if plan.source = "Showbox" then
        query.fid = text(plan.fid)
    else
        query.share = text(plan.shareKey)
    end if
    if m.global.autoTiming then query.auto = "1" else query.auto = "0"
    if m.capPicked >= 0 then query.pick = m.capPicked.ToStr()
    m.capWaitingBefore = text(m.capTiming.state) = "waiting"
    api("/api/roku/captions", query, "onCaptions")
end sub

sub onCaptions(event as Object)
    answer = event.getData()
    if not answer.ok or m.capOff or answer.data.cues = invalid then return
    data = answer.data
    m.capOptions = data.options
    m.capPicked = data.picked
    m.cues = data.cues
    m.cueAt = 0
    m.capTiming = data.timing
    state = text(m.capTiming.state)
    if state = "waiting" then
        m.capPoll.control = "start"
        showNote("Timing captions to the video…")
    else if state = "timed" and m.capWaitingBefore then
        showNote("Captions timed to the video")
    else if state = "nomatch" then
        showNote("These captions don't match this video: press Down to pick others")
    end if
    if m.cues.Count() > 0 then m.cueTimer.control = "start"
    if m.menu.visible then showMenu(m.menuLevel)
end sub

' The caption for where the video is (moved by the menu's earlier and later).
sub showCue()
    count = m.cues.Count()
    if count = 0 or m.capOff then
        m.captionGroup.visible = false
        return
    end if
    t = m.video.position - m.capHand
    at = m.cueAt
    if at >= count then at = count - 1
    while at > 0 and m.cues[at].s > t
        at = at - 1
    end while
    while at < count - 1 and m.cues[at + 1].s <= t
        at = at + 1
    end while
    m.cueAt = at
    cue = m.cues[at]
    if cue.s <= t and t < cue.e then
        if m.capText.text <> cue.t then
            m.capText.text = cue.t
            m.capShadow.text = cue.t
            if m.global.captionBox then
                size = m.capText.boundingRect()
                m.capBox.width = size.width + 40
                m.capBox.height = size.height + 16
                m.capBox.translation = [960 - (size.width + 40) / 2, 1000 - size.height - 8]
                m.capBox.visible = true
            end if
        end if
        m.captionGroup.visible = true
    else
        m.captionGroup.visible = false
    end if
end sub

sub showNote(words as String)
    m.noteText.text = words
    size = m.noteText.boundingRect()
    width = size.width + 48
    m.noteBack.width = width
    m.noteBack.translation = [960 - width / 2, 48]
    m.noteText.translation = [960 - size.width / 2, 48]
    m.note.visible = true
    m.noteTimer.control = "stop"
    m.noteTimer.control = "start"
end sub

sub hideNote()
    m.note.visible = false
end sub

' What auto-timing is doing, in a few words.
function timingWords() as String
    if not m.global.autoTiming then return "Off"
    state = text(m.capTiming.state)
    if state = "timed" then return "On, timed"
    if state = "waiting" then return "On, timing…"
    if state = "nomatch" then return "On, these don't match"
    if state = "unavailable" then return "On, can't hear this copy"
    return "On"
end function

function handWords() as String
    if m.capHand = 0 then return "as timed"
    words = Str(Abs(m.capHand)).Trim()
    if m.capHand > 0 then return words + " s later"
    return words + " s earlier"
end function

' ---------------------------------------------------------------- the menu

sub openMenu()
    m.lastLevel = ""
    showMenu("main")
    m.menu.visible = true
    m.menuList.setFocus(true)
end sub

sub closeMenu()
    m.menu.visible = false
    m.menuLevel = ""
    m.video.setFocus(true)
end sub

' One page of the menu: its lines, and what each does (m.menuActs).
sub showMenu(level as String)
    m.menuLevel = level
    lines = []
    acts = []
    plan = m.plan
    hint = "Back closes the menu."
    if level = "main" then
        m.menuTitle.text = "Watching"
        name = "Off"
        if not m.capOff then name = "On"
        if not m.capOff and m.capPicked >= 0 and m.capPicked < m.capOptions.Count() then name = m.capOptions[m.capPicked].label
        lines.Push("Captions: " + name)
        acts.Push("captions")
        if not m.capOff then
            lines.Push("Auto-timing: " + timingWords())
            acts.Push("timing")
            lines.Push("Captions earlier (now " + handWords() + ")")
            acts.Push("earlier")
            lines.Push("Captions later")
            acts.Push("later")
            lines.Push("Caption size: " + sizeName(m.global.captionSize))
            acts.Push("size")
        end if
        if plan <> invalid and plan.copies <> invalid and plan.copies.Count() > 1 then
            lines.Push("Source: " + copyName())
            acts.Push("source")
        end if
        tracks = m.video.availableAudioTracks
        if tracks <> invalid and tracks.Count() > 1 then
            lines.Push("Sound: " + trackName(currentTrack()))
            acts.Push("audio")
        end if
        if plan <> invalid and plan.next <> invalid then
            lines.Push("Next episode (S" + text(plan.next.season) + " E" + text(plan.next.episode) + ")")
            acts.Push("next")
        end if
        if plan <> invalid and plan.source <> invalid then hint = "Playing from " + text(plan.source) + ". Back closes the menu."
    else if level = "captions" then
        m.menuTitle.text = "Captions"
        lines.Push("Off")
        acts.Push("capOff")
        for i = 0 to m.capOptions.Count() - 1
            mark = ""
            if not m.capOff and i = m.capPicked then mark = "✓ "
            lines.Push(mark + text(m.capOptions[i].label))
            acts.Push("cap" + i.ToStr())
        end for
        if m.capOptions.Count() = 0 then hint = "Turn captions on (or wait a moment) to see the ones there are."
    else if level = "size" then
        m.menuTitle.text = "Caption size"
        for each size in ["small", "medium", "large", "huge"]
            mark = ""
            if size = text(m.global.captionSize) then mark = "✓ "
            lines.Push(mark + sizeName(size))
            acts.Push("size:" + size)
        end for
    else if level = "source" then
        m.menuTitle.text = "Source"
        for i = 0 to plan.copies.Count() - 1
            copy = plan.copies[i]
            mark = ""
            if isPlaying(copy) then mark = "✓ "
            lines.Push(mark + text(copy.label))
            acts.Push("copy" + i.ToStr())
        end for
        hint = "Picks up where you are."
    else if level = "audio" then
        m.menuTitle.text = "Sound"
        tracks = m.video.availableAudioTracks
        for i = 0 to tracks.Count() - 1
            mark = ""
            if text(tracks[i].Track) = currentTrack() then mark = "✓ "
            lines.Push(mark + trackName(text(tracks[i].Track)))
            acts.Push("track" + i.ToStr())
        end for
    end if
    content = CreateObject("roSGNode", "ContentNode")
    for each line in lines
        item = content.createChild("ContentNode")
        item.title = line
    end for
    at = m.menuList.itemFocused
    m.menuList.content = content
    m.menuActs = acts
    if level = m.lastLevel and at > 0 and at < lines.Count() then
        m.menuList.jumpToItem = at
    else
        m.menuList.jumpToItem = 0
    end if
    m.lastLevel = level
    m.menuHint.text = hint
end sub

function sizeName(size as Dynamic) as String
    names = { small: "Small", medium: "Medium", large: "Large", huge: "Extra large" }
    name = names[text(size)]
    if name = invalid then return "Medium"
    return name
end function

' The copy playing: a Showbox file by its number, another source's by its share key.
function isPlaying(copy as Object) as Boolean
    plan = m.plan
    if text(copy.fid) <> text(plan.fid) then return false
    if plan.source = "Showbox" then return true
    return text(copy.copy) = text(plan.shareKey)
end function

function copyName() as String
    for each copy in m.plan.copies
        if isPlaying(copy) then return text(copy.label)
    end for
    return text(m.plan.source)
end function

function currentTrack() as String
    return text(m.video.currentAudioTrack)
end function

function trackName(track as String) as String
    tracks = m.video.availableAudioTracks
    if tracks = invalid then return "Main"
    for each one in tracks
        if text(one.Track) = track then
            name = text(one.Name)
            if name = "" then name = text(one.Language)
            if name = "" then name = "Track " + track
            return name
        end if
    end for
    return "Main"
end function

sub onMenuPick()
    at = m.menuList.itemSelected
    if at < 0 or at >= m.menuActs.Count() then return
    act = m.menuActs[at]
    if act = "captions" or act = "size" or act = "source" or act = "audio" then
        showMenu(act)
    else if act = "timing" then
        m.global.autoTiming = not m.global.autoTiming
        keepSetting("autoTiming", m.global.autoTiming)
        loadCaptions()
        showMenu("main")
    else if act = "earlier" then
        m.capHand = m.capHand - 0.5
        showMenu("main")
    else if act = "later" then
        m.capHand = m.capHand + 0.5
        showMenu("main")
    else if act = "next" then
        closeMenu()
        saveProgress()
        m.wantCopy = invalid
        load(m.plan.title, m.plan.type, text(m.plan.year), m.plan.next.season, m.plan.next.episode, false)
    else if act = "capOff" then
        m.capOff = true
        m.capPoll.control = "stop"
        m.captionGroup.visible = false
        showMenu("main")
    else if Left(act, 3) = "cap" then
        m.capOff = false
        m.capPicked = Mid(act, 4).ToInt()
        m.capHand = 0.0
        loadCaptions()
        showMenu("main")
    else if Left(act, 5) = "size:" then
        m.global.captionSize = Mid(act, 6)
        keepSetting("captionSize", m.global.captionSize)
        styleCaptions()
        m.capText.text = ""
        showMenu("main")
    else if Left(act, 4) = "copy" then
        copy = m.plan.copies[Mid(act, 5).ToInt()]
        closeMenu()
        m.wantCopy = copy
        m.retryAt = Int(m.video.position)
        saveProgress()
        load(m.plan.title, m.plan.type, text(m.plan.year), m.plan.season, m.plan.episode, true)
    else if Left(act, 5) = "track" then
        tracks = m.video.availableAudioTracks
        m.video.audioTrack = tracks[Mid(act, 6).ToInt()].Track
        showMenu("main")
    end if
end sub


' A YouTube video: the computer's hidden YouTube player keeps it as it plays, and Catalog hands it
' over as HLS (/api/youtube/play, src/lib/server/youtube.ts). Nothing is saved: YouTube keeps its own.
sub playYouTube(params as Object)
    m.plan = invalid
    m.replayPlan = invalid
    m.youtube = params
    showWaiting("Loading " + text(params.label) + "…")
    api("/api/youtube/play", { v: params.youtube }, "onYouTube")
end sub

sub onYouTube(event as Object)
    answer = event.getData()
    if not answer.ok or answer.data.url = invalid then
        problem = "This video can't be played right now."
        if answer.data <> invalid and answer.data.error <> invalid then problem = answer.data.error
        showWaiting(problem)
        return
    end if
    content = CreateObject("roSGNode", "ContentNode")
    content.url = m.global.server + answer.data.url
    content.streamFormat = "hls"
    content.httpHeaders = videoHeaders([])
    content.title = text(m.youtube.label)
    m.played = false
    m.video.content = content
    m.video.control = "play"
    m.video.setFocus(true)
end sub

' A replay of a past game (/api/live/replay: the first of its versions that plays).
sub playReplay(params as Object)
    m.plan = invalid
    m.replayPlan = invalid
    m.replayParams = params
    showWaiting("Loading " + text(params.label) + "…")
    api("/api/live/replay", { id: params.replay }, "onReplay")
end sub

sub onReplay(event as Object)
    answer = event.getData()
    if not answer.ok or answer.data.url = invalid then
        problem = "This replay can't be played right now."
        if answer.ok and answer.data.error <> invalid then problem = answer.data.error
        showWaiting(problem)
        return
    end if
    content = CreateObject("roSGNode", "ContentNode")
    content.url = m.global.server + answer.data.url
    content.streamFormat = "hls"
    content.httpHeaders = videoHeaders([])
    content.title = text(m.replayParams.label)
    ' Where this profile left it, and its place kept as it plays (Continue Watching, Recently watched).
    if answer.data.resumeAt <> invalid and answer.data.resumeAt > 0 then content.playStart = answer.data.resumeAt
    ' Held at its top quality (it dropped to a blurry one now and then by itself).
    if answer.data.minBandwidth <> invalid and answer.data.minBandwidth > 0 then content.MinBandwidth = answer.data.minBandwidth
    replay = answer.data.replay
    m.played = false
    m.replayPlan = { title: text(replay.title), type: "replay", season: 0, episode: 0, poster: text(replay.poster), shareKey: "", fid: 0 }
    api("/api/live/watched", {}, "ignore", "POST", { replay: text(m.replayParams.replay), title: text(replay.title), poster: text(replay.poster), sport: text(replay.sport) })
    m.video.content = content
    m.video.control = "play"
    m.video.setFocus(true)
    m.saver.control = "start"
end sub

' A live channel: its playlist is always at the same address (/api/live/playlist).
sub playLive(params as Object)
    m.plan = invalid
    m.live = params
    showWaiting("Loading " + text(params.channelName) + "…")
    content = CreateObject("roSGNode", "ContentNode")
    content.url = m.global.server + "/api/live/playlist?ch=" + text(params.channel)
    content.streamFormat = "hls"
    content.live = true
    content.httpHeaders = videoHeaders([])
    content.title = text(params.label)
    m.video.content = content
    m.video.control = "play"
    m.video.setFocus(true)
    m.liveNoted = false
    m.played = false
end sub

sub onState()
    state = m.video.state
    if state = "buffering" then
        ' The Roku's player shows its own loading circle: ours goes, so there aren't two.
        m.waiting.visible = false
    else if state = "playing" then
        m.played = true
        m.waiting.visible = false
        m.retried = false
        if m.japanese = true and not m.audioPicked then pickJapanese()
        if m.live <> invalid and not m.liveNoted then
            m.liveNoted = true
            api("/api/live/watched", {}, "ignore", "POST", { id: m.live.channel, name: m.live.channelName })
        end if
        if m.plan <> invalid and not m.skipsAsked and m.plan.type = "tv" and m.video.duration > 60 then askSkips()
    else if state = "error" then
        if m.live <> invalid then
            showWaiting("This channel can't be played right now. Press * for the game's other channels.")
        else if m.youtube <> invalid then
            showWaiting("The video stopped working (" + m.video.errorMsg + "). Press Back, and try again.")
        else if not m.retried and m.plan <> invalid then
            ' Stopped working: a fresh link, from where it was (once).
            m.retried = true
            m.retryAt = Int(m.video.position)
            showWaiting("Getting a fresh link…")
            api("/api/roku/play", { title: m.plan.title, type: m.plan.type, year: text(m.plan.year), season: m.plan.season, episode: m.plan.episode, refresh: "1", fid: text(m.plan.fid), copy: text(m.plan.shareKey) }, "onPlan")
        else
            showWaiting("The video stopped working (" + m.video.errorMsg + "). Press Back, and try again.")
        end if
    else if state = "finished" then
        ' "Finished" without ever playing is a video the Roku couldn't play: it used to go on to the
        ' next episode, or back out of a film, without a word (2026-11-08).
        if m.played <> true then
            showWaiting("This video wouldn't play on the Roku (" + text(m.video.errorMsg) + "). Press Back, and try again.")
            return
        end if
        finished()
    end if
end sub

sub ignore()
end sub

' Anime starts in Japanese, as in Catalog's player (a Showbox copy often has the English dub too).
sub pickJapanese()
    m.audioPicked = true
    tracks = m.video.availableAudioTracks
    if tracks = invalid then return
    for each track in tracks
        language = LCase(text(track.Language))
        if language = "jpn" or language = "ja" or Instr(1, LCase(text(track.Name)), "japan") > 0 then
            m.video.audioTrack = track.Track
            return
        end if
    end for
end sub

' Intro, recap and credits (/api/roku/skips: the same as Catalog's player has them).
sub askSkips()
    m.skipsAsked = true
    plan = m.plan
    api("/api/roku/skips", { title: plan.title, year: text(plan.year), season: plan.season, episode: plan.episode, overall: plan.overall, duration: Int(m.video.duration), fid: plan.fid, copy: plan.copy }, "onSkips")
end sub

sub onSkips(event as Object)
    answer = event.getData()
    if answer.ok then m.skips = answer.data.segments
end sub

' As Catalog's player on a TV: an intro, a recap or the credits skipped by themselves (unless the story
' goes on over the song), the last credits going on to the next episode; otherwise a Skip button.
sub onPosition()
    at = m.video.position
    if m.skips = invalid or m.skips.Count() = 0 or m.video.state <> "playing" then return
    segment = invalid
    for each one in m.skips
        if at >= one.start and at < one.end - 1 then segment = one
    end for
    if segment = invalid then
        hideSkip()
        return
    end if
    key = segment.type + text(segment.start)
    canSkipItself = segment.mixed <> true
    if m.global.autoSkip and canSkipItself and not m.skipped.DoesExist(key) then
        m.skipped[key] = true
        skipPast(segment)
        return
    end if
    if m.showing = invalid then showSkip(segment)
end sub

sub skipPast(segment as Object)
    hideSkip()
    plan = m.plan
    if segment.type = "credits" and segment.end >= m.video.duration - 20 and plan <> invalid and plan.next <> invalid and m.global.autoplay then
        saveProgress()
        load(plan.title, plan.type, text(plan.year), plan.next.season, plan.next.episode, false)
        return
    end if
    ' An intro or recap lands on its last second, as on the computer (the story's first words weren't cut off),
    ' unless another part starts right there (Hawkeye S1E5's recap after its intro): its Skip shows at once.
    nextPart = false
    if m.skips <> invalid then
        for each one in m.skips
            if one.start >= segment.end - 0.5 and one.start <= segment.end + 0.5 and one.start > segment.start then nextPart = true
        end for
    end if
    if segment.type = "credits" or nextPart then
        m.video.seek = segment.end
    else
        m.video.seek = segment.end - 1
    end if
end sub

sub showSkip(segment as Object)
    m.showing = segment
    words = { intro: "Skip intro", recap: "Skip recap", credits: "Skip credits" }
    m.skipLabel.text = words[segment.type]
    m.skipButton.visible = true
    ' (OK is the button's while it shows; the Roku's player has the rest back after.)
    m.top.setFocus(true)
end sub

sub hideSkip()
    if m.showing = invalid then return
    m.showing = invalid
    m.skipButton.visible = false
    if m.top.isInFocusChain() then m.video.setFocus(true)
end sub

' The end: its place saved as finished, then the next episode if there is one and it's wanted.
sub finished()
    saveProgress()
    plan = m.plan
    ' Watched to the end: what the computer downloaded of it ahead can go (7Movies, Movy).
    if plan <> invalid and (plan.source = "Movy" or plan.source = "7Movies") then
        api("/api/watch/download-ahead", { copy: plan.shareKey }, "ignore", "DELETE")
    end if
    if plan = invalid then
        m.top.action = { go: "back" }
        return
    end if
    if plan.next <> invalid and m.global.autoplay then
        load(plan.title, plan.type, text(plan.year), plan.next.season, plan.next.episode, false)
    else
        ' The last episode there is: caught up (it comes back when a new one is out).
        if plan.type = "tv" and plan.next = invalid then api("/api/watch/caught-up", {}, "ignore", "POST", { title: plan.title, year: text(plan.year), season: plan.season, episode: plan.episode })
        m.top.action = { go: "back" }
    end if
end sub

' Where it's got to, as Catalog's player saves it (Continue Watching, the episode ticks).
sub saveProgress()
    plan = m.plan
    if plan = invalid then plan = m.replayPlan
    if plan = invalid then return
    at = m.video.position
    length = m.video.duration
    if at < 5 or length <= 0 then return
    if m.video.state = "finished" then at = length
    api("/api/watch/progress", {}, "ignore", "POST", {
        title: plan.title, type: plan.type, season: plan.season, episode: plan.episode,
        currentTime: at, duration: length, posterUrl: plan.poster, shareKey: plan.shareKey, fid: plan.fid
    })
end sub

sub onClosing()
    saveProgress()
    m.saver.control = "stop"
    m.cueTimer.control = "stop"
    m.capPoll.control = "stop"
    m.noteTimer.control = "stop"
    m.video.control = "stop"
    if m.captionsBefore <> invalid then m.video.globalCaptionMode = m.captionsBefore
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    ' The menu: Back closes it (a page inside it goes back to the first); the list has the rest.
    if m.menu.visible then
        if key = "back" or key = "left" then
            if m.menuLevel <> "main" and m.menuLevel <> "" then
                showMenu("main")
            else
                closeMenu()
            end if
            return true
        end if
        if key = "options" then
            closeMenu()
            return true
        end if
        return false
    end if
    ' The Skip button: OK presses it; anything else hands the remote back to the player.
    if m.showing <> invalid then
        if key = "OK" then
            m.skipped[m.showing.type + text(m.showing.start)] = true
            skipPast(m.showing)
            return true
        end if
        if key = "play" then
            if m.video.state = "paused" then m.video.control = "resume" else m.video.control = "pause"
            return true
        end if
        if key <> "back" then
            m.video.setFocus(true)
            return false
        end if
    end if
    ' * on a game: its other channels.
    if key = "options" and m.live <> invalid and text(m.live.game) <> "" then
        api("/api/live/game", { id: m.live.game }, "onGame")
        return true
    end if
    ' Down (or *) on a film or an episode: the player's menu, as on the Fire TV.
    if (key = "down" or key = "options") and m.plan <> invalid and m.live = invalid then
        openMenu()
        return true
    end if
    return false
end function

sub onGame(event as Object)
    answer = event.getData()
    if not answer.ok or answer.data.game = invalid then return
    m.channels = answer.data.game.channels
    names = []
    for each channel in m.channels
        names.Push(channel.name)
        if names.Count() = 10 then exit for
    end for
    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = "Watch on"
    dialog.message = [answer.data.game.title]
    dialog.buttons = names
    dialog.observeField("buttonSelected", "onChannel")
    m.dialog = dialog
    m.top.getScene().dialog = dialog
end sub

sub onChannel()
    channel = m.channels[m.dialog.buttonSelected]
    m.dialog.close = true
    m.video.control = "stop"
    playLive({ channel: channel.id, channelName: channel.name, game: m.live.game, label: m.live.label })
end sub

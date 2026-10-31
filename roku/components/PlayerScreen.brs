sub init()
    m.video = m.top.findNode("video")
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
    m.captionsBefore = invalid
    m.skips = []
    m.skipped = {}
    m.showing = invalid
    m.retried = false
    m.retryAt = 0
end sub

sub start()
    params = m.top.params
    if params.live = true then
        playLive(params)
    else if text(params.replay) <> "" then
        playReplay(params)
    else
        load(text(params.title), text(params.type), text(params.year), number(params.season), number(params.episode), params.fromStart = true)
    end if
end sub

sub showWaiting(words as String)
    m.waiting.visible = true
    m.spinner.visible = Right(words, 1) = "…"
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
    ' English subtitles: on, as everything starts on a TV (Settings turns that off), and always
    ' for anime in Japanese.
    if plan.subtitles <> invalid then
        content.subtitleTracks = [{ language: "eng", trackName: plan.subtitles, description: "English" }]
    end if
    m.japanese = plan.anime = true
    m.audioPicked = false
    m.skipsAsked = false
    m.video.content = content
    if plan.subtitles <> invalid and (m.global.captions or m.japanese) then
        if m.captionsBefore = invalid then m.captionsBefore = m.video.globalCaptionMode
        m.video.globalCaptionMode = "On"
        m.video.subtitleTrack = plan.subtitles
    end if
    m.video.control = "play"
    m.video.setFocus(true)
    m.saver.control = "start"
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
    replay = answer.data.replay
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
end sub

sub onState()
    state = m.video.state
    if state = "playing" then
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
        else if not m.retried and m.plan <> invalid then
            ' Stopped working: a fresh link, from where it was (once).
            m.retried = true
            m.retryAt = Int(m.video.position)
            showWaiting("Getting a fresh link…")
            api("/api/roku/play", { title: m.plan.title, type: m.plan.type, year: text(m.plan.year), season: m.plan.season, episode: m.plan.episode, refresh: "1" }, "onPlan")
        else
            showWaiting("The video stopped working (" + m.video.errorMsg + "). Press Back, and try again.")
        end if
    else if state = "finished" then
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
    m.video.seek = segment.end
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
    m.video.control = "stop"
    if m.captionsBefore <> invalid then m.video.globalCaptionMode = m.captionsBefore
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
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

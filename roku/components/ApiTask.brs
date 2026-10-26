sub init()
    m.top.functionName = "ask"
end sub

' Asks, waits for the answer (two minutes at most: finding a video can take a while), and hands
' it back as { ok, code, data, signIn }. `signIn`: Catalog wants its PIN (it sent its sign-in
' page instead of an answer).
sub ask()
    request = m.top.request
    transfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    transfer.SetMessagePort(port)

    url = m.global.server + request.path
    if request.query <> invalid then
        separator = "?"
        for each name in request.query
            value = request.query[name]
            if value <> invalid then
                url = url + separator + name + "=" + transfer.Escape(text(value))
                separator = "&"
            end if
        end for
    end if
    transfer.SetUrl(url)
    headers = catalogHeaders()
    for each name in headers
        transfer.AddHeader(name, headers[name])
    end for
    transfer.RetainBodyOnError(true)

    method = "GET"
    if request.method <> invalid then method = request.method
    if method = "GET" then
        transfer.AsyncGetToString()
    else
        transfer.AddHeader("Content-Type", "application/json")
        transfer.SetRequest(method)
        body = "{}"
        if request.body <> invalid then body = FormatJson(request.body)
        transfer.AsyncPostFromString(body)
    end if

    result = { ok: false, code: 0, data: invalid, signIn: false }
    msg = wait(120000, port)
    if type(msg) = "roUrlEvent" then
        result.code = msg.GetResponseCode()
        answer = msg.GetString()
        if answer <> invalid and answer <> "" then
            if Left(answer, 1) = "{" or Left(answer, 1) = "[" then
                result.data = ParseJson(answer)
            else if result.code = 200 and Instr(1, answer, "PIN") > 0 then
                result.signIn = true
            end if
        end if
        result.ok = result.code >= 200 and result.code < 300 and result.data <> invalid
    else
        transfer.AsyncCancel()
    end if
    m.top.response = result
end sub

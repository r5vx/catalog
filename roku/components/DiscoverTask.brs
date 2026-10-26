sub init()
    m.top.functionName = "look"
end sub

' Shouts "CATALOG_DISCOVER" across the Wi-Fi (UDP 41734) a few times; each computer with Catalog
' open answers { app, name, port } (electron/main.cjs). Hands back [{ name, address }] after
' about three seconds.
sub look()
    port = CreateObject("roMessagePort")
    socket = CreateObject("roDatagramSocket")
    socket.SetMessagePort(port)
    here = CreateObject("roSocketAddress")
    here.SetPort(0)
    socket.SetAddress(here)
    socket.SetBroadcast(true)
    everyone = CreateObject("roSocketAddress")
    everyone.SetAddress("255.255.255.255:41734")
    socket.SetSendToAddress(everyone)
    socket.NotifyReadable(true)

    found = []
    seen = {}
    timer = CreateObject("roTimespan")
    shouts = 0
    while timer.TotalMilliseconds() < 3000
        if shouts < 3 and timer.TotalMilliseconds() >= shouts * 800 then
            socket.SendStr("CATALOG_DISCOVER")
            shouts = shouts + 1
        end if
        msg = wait(200, port)
        if type(msg) = "roSocketEvent" and socket.IsReadable() then
            answer = ParseJson(socket.ReceiveStr(4096))
            from = socket.GetReceivedFromAddress()
            if answer <> invalid and answer.app = "catalog" and from <> invalid then
                address = "http://" + from.GetHostName() + ":" + answer.port.ToStr()
                if not seen.DoesExist(address) then
                    seen[address] = true
                    name = answer.name
                    if name = invalid then name = from.GetHostName()
                    found.Push({ name: name, address: address })
                end if
            end if
        end if
    end while
    socket.Close()
    m.top.found = found
end sub

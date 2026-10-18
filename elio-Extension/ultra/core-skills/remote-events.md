# remote-events

Use when: code that sends data between client and server, or a remote that fires but nothing happens.

A remote payload has three ends: the sender, the server handler, and the receiver.
- If you change the arguments at one end, check the other two. A mismatch fails silently.
- Use plain RemoteEvents for gameplay. Keep the names in the Net module.
- When a remote seems to do nothing, check in this order: the name matches on both
  sides; the server listens before the client fires; the arguments match in count and type;
  the server handler's validation is not rejecting the request.

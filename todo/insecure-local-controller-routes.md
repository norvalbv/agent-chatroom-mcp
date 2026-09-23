---
status: open
added: 2026-09-23
from: reuse/sandbox build report (risks)
---
# Seats can stop other agents through the hub's token-free controller routes

On a hub started with CHATROOM_INSECURE_LOCAL=1, controller routes such as
POST /agents/:name/stop need no token, and any seat can reach loopback. Even a sandboxed seat
(allowLocalBinding opens every loopback port on macOS) can stop other agents without a signal.
A hub with CHATROOM_HUMAN_TOKEN set closes it, because seats never get the token.

Decide: require the token for controller routes even in insecure-local mode (dev hubs and pool
hubs would then need one generated per run), or bind controller routes to a separate port.
Done when a regression test shows a seat's unauthenticated stop request is refused.

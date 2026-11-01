# CrowdQuest

**Chat can't backseat. Chat can bet on it.**

CrowdQuest turns a streamer's stuck moment into a deterministic chat game. A round opens when the streamer seals a hint or uses `!stuck`. Viewers stake local `keys` on `!solo` or `!caves`; the first unlock settles the bet. A streamer can make a timed vow, chat can look up broken vows with `!receipts`, and solving the puzzle scores sealed hints into the Oracle hall of fame. The dark vault overlay reacts to hints, unlocks and active vows.

## Run locally

Requires Node.js 18 or newer. No package install is needed.

```sh
npm start
```

Open **http://localhost:4173**. CrowdQuest saves demo points, hints and receipts in this browser's local storage. The Twitch access token is kept in memory only and is cleared when you disconnect or close the tab.

## Connect Twitch chat

1. Create a Twitch application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps) with OAuth Redirect URL `http://localhost:4173/oauth/callback`.
2. In CrowdQuest, choose **Connect Twitch**, enter that app's Client ID and the channel login to join, then authorize chat read/write, `user:write:chat`, and `moderator:manage:chat_messages` in the Twitch popup. Pinning a report requires the connected account to be the broadcaster or a moderator in that channel.
3. Send `!stuck`, `!hint <clue>`, `!solo <keys>`, `!caves <keys>`, `!unlock <n>`, `!vow <time> <promise>`, `!receipts`, `!keys`, or `!solved <what worked>` in that channel.

The live connection uses Twitch's secure IRC WebSocket to read chat and applies CrowdQuest commands. Vault Reports use Twitch's Helix Send Chat Message API with its `pin` option; the connected account must have permission to pin. The dashboard's quick commands and simulator remain available for a scripted demo. The server binds to `127.0.0.1` and serves only the app's local static files.

## OBS browser source

Use **http://localhost:4173/overlay** as a browser source on the same computer. It is transparent outside the vault card and receives live updates from the local server, so it syncs with OBS's separate browser runtime as well as ordinary browser tabs. A remotely hosted overlay is needed for OBS on another device.

## Game rules in this prototype

- New viewers start with 50 keys; their first chat message earns 5 more. Bets are reserved when placed.
- A winning side gets its own stake back plus a proportional share of losing stakes. If everyone picks the wrong side, wagers are returned.
- `!unlock 1` settles the round as a cave and releases the first sealed clue; `!unlock 3` closes the round after three unlocks.
- Oracle scoring uses a small, deterministic keyword overlap check between sealed hints and the solution. This keeps the demo reproducible and avoids claiming that a language model made a call.
- Vows, scores, keys and receipts persist in browser storage. The demo reset button clears that local data.

## Current scope

The build includes a Twitch chat connection, local key economy, pride bets, timed vows and receipts, Oracle leaderboard, vault pressure, OBS overlay, redacted reveals, spoiler redaction, hint auctions, mercy votes, and Vault Report posting and pinning. The public deployment still needs a hosted service for OAuth/session management and overlay state; don't put a Twitch client secret in browser code.

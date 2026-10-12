#!/usr/bin/env python3
"""
Trisara Signal API — Dwellir pilot
==================================
Polls Robinhood Chain Chainlink equity feeds every 60s, computes the
session-awareness signal from the one-pager, and serves it as JSON.

Session state comes from the onchain AnchorClock (testnet 46630, full
2026-27 holiday bitmaps). The action comes from the onchain Rulebook
(testnet 46630, Step 0 rules published). Feed staleness still fails
closed in the API. If either contract read fails, the pilot Python
fallback (NYSE hours, hardcoded rules) is used and labelled as such.

Signal fields per feed: anchor, anchor_state, clock_source, last_live_print,
staleness_sec, action, reason, rule_param, rule_source, resumes_at.

READ-ONLY. No transactions, no gas, no keys.

Run:   python offchain/signal-api.py [--port 8080]
Endpoints:
  GET /signal          all feeds
  GET /signal/AAPL     one feed (AAPL | TSLA | NVDA)
  GET /health          service status

Snapshot of the latest signal is also written to signal/latest.json each poll.
"""

import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from zoneinfo import ZoneInfo

# ---------------------------------------------------------------- config

FEEDS = {
    "AAPL": "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0",
    "TSLA": "0x4A1166a659A55625345e9515b32adECea5547C38",
    "NVDA": "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
}

RH_RPCS = ["https://rpc.mainnet.chain.robinhood.com"]
# Per-chain testnet contracts: the session clock and rulebook live on each.
# Prices come from mainnet feeds (real prints, same stocks on every chain);
# clock + rules are read per-chain from testnet (same bytecode as mainnet).
CHAINS = {
    "46630": {
        "name": "Robinhood",
        "rpc": "https://rpc.testnet.chain.robinhood.com",
        "clock": "0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6",
        "rulebook": "0x2f8c1823bD51A71873b00eB4bc66BA6Cf76634cC",
    },
    "998": {
        "name": "HyperEVM",
        "rpc": "https://rpc.hyperliquid-testnet.xyz/evm",
        "clock": "0xC2529BD7e5C8038516908189A142070953b7ad2e",
        "rulebook": "0x9E66204Fd16238102D0D9c5160D3E02Ea3f5558b",
    },
    "42431": {
        "name": "Tempo",
        "rpc": "https://rpc.testnet.tempo.xyz",
        "clock": "0x7F5C6E3eAACD95b3acDEC32Ab47d89887ceE74dA",
        "rulebook": "0x713420180cec1E1EF394fb9e2606e0bd14764014",
    },
}
# Backwards compat for single-chain callers
TESTNET_RPC = CHAINS["46630"]["rpc"]
ANCHOR_CLOCK = CHAINS["46630"]["clock"]
RULEBOOK = CHAINS["46630"]["rulebook"]

INTERVAL_SEC = 60
DECIMALS = 8
LATEST_ROUND_DATA = "0xfeaf968c"
STALE_THRESHOLD_SEC = 900  # 15 min: OPEN anchor + older print = fail closed

# Onchain selectors
IS_OPEN_SIG = "0xfe4d2463"      # isOpen(uint8,uint256)
DECISION_SIG = "0xbc5a1b04"     # decision(bytes32,uint8)
ANCHOR_EQUITY_US = 0
CLS_SWAP = 0
WILDCARD_ASSET = "0x" + "00" * 32
ACTION_NAMES = {0: "ALLOW", 1: "CAP", 2: "COLLAR", 3: "DEFER", 4: "HALT"}

ET = ZoneInfo("America/New_York")
# Pilot simplification: NYSE regular hours, holidays not modelled here.
# The onchain AnchorClock carries the full 2026-27 holiday bitmaps.
NYSE_OPEN = (9, 30)
NYSE_CLOSE = (16, 0)

# ---------------------------------------------------------------- feed reads (proven in weekend1-logger.py)

def rpc_call(url, method, params, timeout=15):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    cmd = ["curl", "-s", "-m", str(timeout), "-X", "POST", url,
           "-H", "Content-Type: application/json",
           "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
           "-d", payload]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
    if out.returncode != 0:
        raise RuntimeError(f"curl rc={out.returncode}: {out.stderr[:100]}")
    return json.loads(out.stdout)


def read_feed(feed_addr):
    try:
        resp = rpc_call(RH_RPCS[0], "eth_call",
                        [{"to": feed_addr, "data": LATEST_ROUND_DATA}, "latest"])
    except Exception as e:
        return {"ok": False, "error": f"rpc: {e}"}
    if "error" in resp:
        return {"ok": False, "error": f"rpc-error: {resp['error']}"}
    raw = resp.get("result") or ""
    if len(raw) < 2 + 5 * 64:
        return {"ok": False, "error": "short response"}
    h = raw[2:]
    try:
        answer = int(h[64:128], 16)
        updated_at = int(h[192:256], 16)
    except ValueError as e:
        return {"ok": False, "error": f"decode: {e}"}
    now = int(time.time())
    return {"ok": True, "price": answer / 10**DECIMALS,
            "updatedAt": updated_at, "stalenessSec": now - updated_at}

# ---------------------------------------------------------------- onchain reads

def _pad_u256(v):
    return format(v, '064x')


def _pad_addr(a):
    return a[2:].lower().rjust(64, '0')


def chain_is_open(now_ts, chain_id="46630"):
    """Read AnchorClock.isOpen(EQUITY_US, now) from the chain's testnet.
    Falls back to the Python NYSE-hours calc if the RPC call fails."""
    cfg = CHAINS[chain_id]
    try:
        data = IS_OPEN_SIG + _pad_u256(ANCHOR_EQUITY_US) + _pad_u256(now_ts)
        resp = rpc_call(cfg["rpc"], "eth_call",
                        [{"to": cfg["clock"], "data": data}, "latest"])
        raw = resp.get("result") or ""
        return int(raw, 16) == 1
    except Exception:
        return None


def chain_decision(chain_id="46630"):
    """Read Rulebook.decision(wildcard, SWAP) from the chain's testnet.
    Returns (action_name, param, reason) or None on failure."""
    cfg = CHAINS[chain_id]
    try:
        data = DECISION_SIG + WILDCARD_ASSET[2:] + _pad_u256(CLS_SWAP)
        resp = rpc_call(cfg["rpc"], "eth_call",
                        [{"to": cfg["rulebook"], "data": data}, "latest"])
        raw = (resp.get("result") or "")[2:]
        if len(raw) < 192:
            return None
        action = int(raw[0:64], 16)
        param = int(raw[64:128], 16)
        reason = bytes.fromhex(raw[128:192]).rstrip(b"\x00").decode(
            "ascii", errors="replace")
        return (ACTION_NAMES.get(action, f"ACTION_{action}"), param, reason)
    except Exception:
        return None


# ---------------------------------------------------------------- anchor calendar (pilot fallback)

def anchor_state(now_utc=None):
    """OPEN if NYSE regular session is live, else CLOSED. Holidays not modelled (pilot)."""
    et = (now_utc or datetime.now(timezone.utc)).astimezone(ET)
    if et.weekday() >= 5:
        return "CLOSED"
    mins = et.hour * 60 + et.minute
    o = NYSE_OPEN[0] * 60 + NYSE_OPEN[1]
    c = NYSE_CLOSE[0] * 60 + NYSE_CLOSE[1]
    return "OPEN" if o <= mins < c else "CLOSED"


def next_open(now_utc=None):
    """Next NYSE 9:30 ET open as ISO string. Holidays not modelled (pilot)."""
    et = (now_utc or datetime.now(timezone.utc)).astimezone(ET)
    d = et.date()
    for _ in range(8):
        if d.weekday() < 5:
            cand = datetime(d.year, d.month, d.day, *NYSE_OPEN, tzinfo=ET)
            if cand > et:
                return cand.astimezone(timezone.utc).isoformat()
        d += timedelta(days=1)
    raise RuntimeError("no open found in 8 days")

# ---------------------------------------------------------------- signal

# Pilot default rulebook (documented, venue-overridable):
#   CLOSED                -> COLLAR / MARKET_CLOSED (bounded weekend trading;
#                            staleness is expected when closed, not a fault)
#   OPEN + fresh          -> ALLOW  / MARKET_OPEN
#   OPEN + stale >= 15min -> HALT   / STALE_FEED   (fail closed)
#   feed read error       -> HALT   / FEED_UNAVAILABLE (fail closed)

def build_signal(sym, feed, chain_id="46630"):
    cfg = CHAINS[chain_id]
    now = datetime.now(timezone.utc)
    now_ts = int(now.timestamp())
    # Session state from the chain's onchain AnchorClock (full holiday bitmaps).
    onchain_open = chain_is_open(now_ts, chain_id)
    if onchain_open is None:
        state = anchor_state(now)  # RPC failed: pilot fallback
        clock_src = "pilot-fallback"
    else:
        state = "OPEN" if onchain_open else "CLOSED"
        clock_src = "onchain"
    # Rule from the chain's onchain Rulebook (Step 0 published Day 6).
    onchain_rule = chain_decision(chain_id)
    base = {"feed": sym, "chain_id": chain_id, "chain": cfg["name"],
            "anchor": "US_EQUITIES", "anchor_state": state,
            "clock_source": clock_src,
            "as_of": now.isoformat()}
    if not feed.get("ok"):
        return {**base, "last_live_print": None, "staleness_sec": None,
                "action": "HALT", "reason": "FEED_UNAVAILABLE",
                "resumes_at": next_open(now),
                "note": feed.get("error", "unknown")[:120]}
    sig = {**base,
           "last_live_print": {
               "price": round(feed["price"], 4),
               "updated_at": datetime.fromtimestamp(
                   feed["updatedAt"], tz=timezone.utc).isoformat()},
           "staleness_sec": feed["stalenessSec"]}
    if state == "CLOSED":
        # Session first: a stale weekend feed is expected, not a fault.
        # Apply the CLOSED-session rule (bounded trading), not the stale-feed halt.
        if onchain_rule is not None:
            action, param, reason = onchain_rule
            sig.update(action=action, reason=reason or "RULEBOOK",
                       rule_param=param, rule_source="onchain",
                       resumes_at=next_open(now))
        else:
            sig.update(action="COLLAR", reason="MARKET_CLOSED",
                       resumes_at=next_open(now),
                       rule_source="pilot-fallback")
    elif feed["stalenessSec"] >= STALE_THRESHOLD_SEC:
        # OPEN session + stale feed = real fault. Fail closed.
        sig.update(action="HALT", reason="STALE_FEED",
                   resumes_at=next_open(now))
    elif onchain_rule is not None:
        action, param, reason = onchain_rule
        sig.update(action=action, reason=reason or "RULEBOOK",
                   rule_param=param, rule_source="onchain",
                   resumes_at=None)
    else:
        # Rulebook RPC failed: pilot hardcoded fallback (documented).
        sig.update(action="ALLOW", reason="MARKET_OPEN",
                   resumes_at=None, rule_source="pilot-fallback")
    return sig

# ---------------------------------------------------------------- service state

STATE = {"signals": {}, "last_poll": None, "errors": 0}
STATE_LOCK = threading.Lock()


def poll_once():
    signals = {}
    for chain_id in CHAINS:
        for sym, addr in FEEDS.items():
            key = f"{chain_id}/{sym}"
            signals[key] = build_signal(sym, read_feed(addr), chain_id)
    with STATE_LOCK:
        STATE["signals"] = signals
        STATE["last_poll"] = datetime.now(timezone.utc).isoformat()
    os.makedirs("signal", exist_ok=True)
    with open("signal/latest.json", "w") as f:
        json.dump({"generated_at": STATE["last_poll"], "signals": signals},
                  f, indent=2)
    ok = sum(1 for s in signals.values() if s["reason"] not in ("FEED_UNAVAILABLE",))
    print(f"[{STATE['last_poll']}] polled {ok}/{len(signals)} ok", flush=True)


def poll_loop():
    while True:
        try:
            poll_once()
        except Exception as e:  # noqa: BLE001 - poller must not die
            with STATE_LOCK:
                STATE["errors"] += 1
            print(f"[poll error] {e}", flush=True)
        time.sleep(INTERVAL_SEC)

# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self):
        with STATE_LOCK:
            signals = dict(STATE["signals"])
            last_poll = STATE["last_poll"]
        if self.path == "/health":
            return self._send(200, {"ok": True, "last_poll": last_poll,
                                    "chains": list(CHAINS),
                                    "feeds": list(FEEDS)})
        if self.path == "/signal":
            return self._send(200, {"generated_at": last_poll, "signals": signals})
        if self.path.startswith("/signal/"):
            parts = self.path[len("/signal/"):].split("/")
            # /signal/<chain_id>/<SYM> or /signal/<SYM> (defaults to 46630)
            if len(parts) == 2 and parts[0] in CHAINS:
                key = f"{parts[0]}/{parts[1].upper()}"
            elif len(parts) == 1:
                key = f"46630/{parts[0].upper()}"
            else:
                return self._send(404, {"error": f"unknown path: {self.path}"})
            if key in signals:
                return self._send(200, signals[key])
            return self._send(404, {"error": f"unknown signal: {key}"})
        return self._send(404, {"error": "use /signal, /signal/{chain}/{SYM}, /health"})


def main():
    port = 8080
    for i, a in enumerate(sys.argv):
        if a == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
    print("Warming up: first poll...", flush=True)
    try:
        poll_once()
    except Exception as e:  # noqa: BLE001
        print(f"[warmup error] {e}", flush=True)
    threading.Thread(target=poll_loop, daemon=True).start()
    srv = HTTPServer(("0.0.0.0", port), Handler)
    print(f"Signal API live on :{port}  (/signal, /signal/AAPL, /health)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")

if __name__ == "__main__":
    main()

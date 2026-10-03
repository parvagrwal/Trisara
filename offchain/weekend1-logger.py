#!/usr/bin/env python3
"""
Weekend-1 Logger — Trisara
===========================
Reads Robinhood Chain Chainlink equity feeds + Hyperliquid perp mids every 60s
and appends timestamped JSON rows to logs/weekend1-YYYYMMDD.jsonl.

READ-ONLY. No transactions, no gas, no keys.

What it captures (Oct 3–5, 2026):
  - AAPL / TSLA / NVDA Chainlink prices + updatedAt age (the weekend-staleness signal)
  - Hyperliquid allMids (HIP-3 equity-perp drift watch)

Run:  python offchain/weekend1-logger.py
Stop:  Ctrl+C
"""

import json
import os
import time
import urllib.request
from datetime import datetime, timezone

# ---------------------------------------------------------------- config

FEEDS = {
    "AAPL": "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0",
    "TSLA": "0x4A1166a659A55625345e9515b32adECea5547C38",
    "NVDA": "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
}

# Primary first; failover in order. Add a secondary RH RPC when available.
RH_RPCS = [
    "https://rpc.mainnet.chain.robinhood.com",
]

HL_INFO_URLS = [
    "https://api.hyperliquid.xyz/info",
]

INTERVAL_SEC = 60
DECIMALS = 8  # verified via decimals() on all three feeds, 2026-10-03

LATEST_ROUND_DATA = "0xfeaf968c"  # latestRoundData() selector

# ---------------------------------------------------------------- helpers

def rpc_call(url, method, params, timeout=15):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            # Some RPC endpoints drop Python's default user-agent; use a neutral one.
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TrisaraWeekendLogger/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def read_feed(rpc_url, feed_addr):
    """Read latestRoundData() and decode the 5-word response."""
    try:
        resp = rpc_call(rpc_url, "eth_call", [{"to": feed_addr, "data": LATEST_ROUND_DATA}, "latest"])
    except Exception as e:
        return {"ok": False, "error": f"rpc: {e}"}
    if "error" in resp:
        return {"ok": False, "error": f"rpc-error: {resp['error']}"}
    raw = resp.get("result") or ""
    if len(raw) < 2 + 5 * 64:
        return {"ok": False, "error": f"short response: {raw[:66]}"}
    h = raw[2:]
    try:
        round_id = int(h[0:64], 16)
        answer = int(h[64:128], 16)
        started_at = int(h[128:192], 16)
        updated_at = int(h[192:256], 16)
        answered_in_round = int(h[256:320], 16)
    except ValueError as e:
        return {"ok": False, "error": f"decode: {e}"}
    now = int(time.time())
    return {
        "ok": True,
        "roundId": round_id,
        "price": answer / (10 ** DECIMALS),
        "priceRaw": str(answer),
        "startedAt": started_at,
        "updatedAt": updated_at,
        "answeredInRound": answered_in_round,
        "stalenessSec": now - updated_at,
    }


def read_feed_with_failover(feed_addr):
    last_err = None
    for rpc in RH_RPCS:
        res = read_feed(rpc, feed_addr)
        if res.get("ok"):
            res["rpc"] = rpc
            return res
        last_err = res.get("error")
    return {"ok": False, "error": last_err}


def read_hl_mids():
    payload = json.dumps({"type": "allMids"}).encode()
    last_err = None
    for url in HL_INFO_URLS:
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return {"ok": True, "mids": json.loads(r.read()), "url": url}
        except Exception as e:
            last_err = str(e)
    return {"ok": False, "error": last_err}


# ---------------------------------------------------------------- main

def main():
    os.makedirs("logs", exist_ok=True)
    log_path = os.path.join("logs", f"weekend1-{datetime.now(timezone.utc):%Y%m%d}.jsonl")
    print(f"Weekend-1 logger starting. Appending to {log_path}. Ctrl+C to stop.", flush=True)
    try:
        while True:
            row = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "robinhood": {},
                "hyperliquid": {},
            }
            for sym, addr in FEEDS.items():
                row["robinhood"][sym] = read_feed_with_failover(addr)
            row["hyperliquid"] = read_hl_mids()
            with open(log_path, "a") as f:
                f.write(json.dumps(row) + "\n")
            parts = []
            for sym in FEEDS:
                r = row["robinhood"][sym]
                if r.get("ok"):
                    parts.append(f"{sym}={r['price']:.4f} (stale {r['stalenessSec']}s)")
                else:
                    parts.append(f"{sym}=ERR")
            hl = "ok" if row["hyperliquid"].get("ok") else "ERR"
            print(f"[{row['ts']}] " + " | ".join(parts) + f" | HL={hl}", flush=True)
            time.sleep(INTERVAL_SEC)
    except KeyboardInterrupt:
        print("\nLogger stopped. Data preserved in " + log_path)


if __name__ == "__main__":
    main()

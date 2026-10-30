"""Run Bedrock Dedicated Server with the add-ons and drive it via stdin.

Setup: download the Linux Bedrock Dedicated Server (minecraft.net), unzip it
into tools/bedrock-server/ (or point BDS_DIR at it) and run build.py first.
By running the server you accept the Minecraft EULA.

usage: python3 bds_harness.py <script.txt> [--fresh] [--seed N]
script lines: a server command, or "wait <seconds>", or "waitfor <text>".
Example script:
    execute positioned 0 70 0 run locate biome botw:no_mans_land
    wait 10
    tickingarea add circle <x> 70 <z> 4 test
    wait 30
    testforblock <x> -31 <z> air

Optional overlay/<PACK>/ folders (BOTW_BP, BOTT_BP, BOTW_RP) next to this
script are copied over the packs, which is handy for debug features.
"""
import json, os, shutil, subprocess, sys, threading, time, queue

HERE = os.path.dirname(os.path.abspath(__file__))
SRV = os.environ.get("BDS_DIR", os.path.join(HERE, "bedrock-server"))
ADDONS = os.path.abspath(os.path.join(HERE, ".."))
LEVEL = "test"

def setup(fresh, seed, experiments):
    packs = {
        "behavior_packs": [("BOTW_BP", f"{ADDONS}/breathe-of-the-wild/behavior_pack"),
                           ("BOTT_BP", f"{ADDONS}/breathe-of-the-trees/behavior_pack")],
        "resource_packs": [("BOTW_RP", f"{ADDONS}/breathe-of-the-wild/resource_pack")],
    }
    world = os.path.join(SRV, "worlds", LEVEL)
    if fresh and os.path.isdir(world):
        shutil.rmtree(world)
    os.makedirs(world, exist_ok=True)
    for kind, items in packs.items():
        entries = []
        for name, src in items:
            dst = os.path.join(SRV, kind, name)
            if os.path.isdir(dst):
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
            overlay = os.path.join(HERE, "overlay", name)
            if os.path.isdir(overlay):
                shutil.copytree(overlay, dst, dirs_exist_ok=True)
            m = json.load(open(os.path.join(src, "manifest.json")))
            entries.append({"pack_id": m["header"]["uuid"], "version": m["header"]["version"]})
        fname = "world_behavior_packs.json" if kind == "behavior_packs" else "world_resource_packs.json"
        json.dump(entries, open(os.path.join(world, fname), "w"))
    props = open(os.path.join(SRV, "server.properties")).read().splitlines()
    want = {"level-name": LEVEL, "level-seed": str(seed), "allow-cheats": "true",
            "content-log-console-output-enabled": "true", "content-log-file-enabled": "true",
            "content-log-level": "info", "online-mode": "false", "allow-list": "false",
            "view-distance": "10", "tick-distance": "4", "gamemode": "creative"}
    out = []
    for line in props:
        k = line.split("=", 1)[0]
        out.append(f"{k}={want.pop(k)}" if k in want else line)
    out += [f"{k}={v}" for k, v in want.items()]
    open(os.path.join(SRV, "server.properties"), "w").write("\n".join(out) + "\n")

def main():
    script = open(sys.argv[1]).read().splitlines()
    fresh = "--fresh" in sys.argv
    seed = sys.argv[sys.argv.index("--seed") + 1] if "--seed" in sys.argv else "12345"
    setup(fresh, seed, None)
    env = dict(os.environ, LD_LIBRARY_PATH=SRV)
    p = subprocess.Popen(["./bedrock_server"], cwd=SRV, stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=env)
    q = queue.Queue()
    log = []
    def reader():
        for line in p.stdout:
            log.append(line); q.put(line)
            print(line, end="", flush=True)
    threading.Thread(target=reader, daemon=True).start()
    def waitfor(text, timeout=180):
        end = time.time() + timeout
        while time.time() < end:
            if any(text in l for l in log): return True
            time.sleep(0.2)
        print(f"!! timeout waiting for {text}"); return False
    waitfor("Server started")
    for line in script:
        line = line.strip()
        if not line or line.startswith("#"): continue
        if line.startswith("wait "):
            time.sleep(float(line.split()[1])); continue
        if line.startswith("waitfor "):
            waitfor(line[8:]); continue
        print(">>", line, flush=True)
        p.stdin.write(line + "\n"); p.stdin.flush()
        time.sleep(0.01)
    p.stdin.write("stop\n"); p.stdin.flush()
    try: p.wait(timeout=60)
    except subprocess.TimeoutExpired: p.kill()

main()

#!/usr/bin/env python3
# helper: python3 tests/st.py '<cfg json>' '<script json>'
import sys, json, urllib.parse, subprocess
cfg, script = sys.argv[1], sys.argv[2]
url = "tests/script_test.html?" + ("case=" + cfg if not cfg.startswith("{") else "cfg=" + urllib.parse.quote(cfg)) + "&script=" + urllib.parse.quote(script)
r = subprocess.run(["bash", "tests/run.sh", url, "300000", "5"], capture_output=True, text=True)
for line in r.stdout.splitlines():
    if "RESULT {" in line:
        s = line[line.index("RESULT")+7:]
        s = s[:s.rindex('}')+1]
        try:
            d = json.loads(s)
            for st in d.get("steps", []): print("  ", *st)
            print("  log:", d.get("log")); 
            if d.get("error"): print("ERROR", d["error"])
        except Exception as e: print(s[:2000])
    elif line.strip(): print(line[:400])

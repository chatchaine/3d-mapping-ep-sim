#!/bin/bash
# usage: tests/autotest.sh <caseId|all> [budget_ms]
# Runs the in-app scripted smoke test headless and prints RESULT / error lines.
CH=~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
timeout ${TMO:-900} $CH --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --enable-logging=stderr --v=0 \
  --window-size=1600,1000 --virtual-time-budget=${2:-600000} --dump-dom "http://localhost:8765/index.html?autotest=$1" 2>&1 \
  | grep -E "CONSOLE|Uncaught|ERROR:" | grep -vE "gpu|GPU|viz|ANGLE|swiftshader" | sed 's/^.*CONSOLE[^"]*"//; s/", source: .*//' | cut -c1-${W:-3000}

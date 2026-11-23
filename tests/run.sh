#!/bin/bash
# usage: tests/run.sh <url-path> [budget_ms]
CH=~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
timeout ${TMO:-600} $CH --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --enable-logging=stderr --v=0 --virtual-time-budget=${2:-60000} --dump-dom "http://localhost:8765/$1" 2>&1 | grep -E "RESULT|LOG|Uncaught|Error|error" | sed 's/^.*CONSOLE[^"]*"//' | head -${3:-40}

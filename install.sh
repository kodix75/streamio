#!/usr/bin/env bash
# ============================================================
#  🌿 STREAMIO — install from anywhere
#    curl -fsSL https://raw.githubusercontent.com/kodix75/streamio/main/install.sh | bash
#
#  Modes / flags:
#    (default)      web app   ->  ~/.streamio + `streamio` command
#    --appimage     desktop   ->  latest AppImage from GitHub Releases
#    --menu         also add an entry to your app menu / grid
#    --no-menu      skip the app-menu entry
#    --wallpaper F  copy your own photo as the custom theme wallpaper
#    --update       refresh ~/.streamio from the repo
#    --uninstall    remove everything this script created
#    --port N       (passed to `streamio` later) custom web port
#
#  Environment overrides:
#    STREAMIO_REPO (default: kodix75/streamio)
#    STREAMIO_PORT (default: 8477)
#    STREAMIO_BACKEND_PORT (default: 7000)
# ============================================================
set -euo pipefail

STREAMIO_REPO="${STREAMIO_REPO:-kodix75/streamio}"
STREAMIO_HOME="$HOME/.streamio"
STREAMIO_BIN="$HOME/.local/bin/streamio"
BRANCH="main"
WALLPAPER_SRC="${STREAMIO_WALLPAPER:-/--none}"

MODE="web"; FLAG_MENU=""; FLAG_UPDATE="no"; WALLFILE=""
for a in "$@"; do
  case "$a" in
    --appimage)  MODE="appimage" ;;
    --menu)      FLAG_MENU="yes" ;;
    --no-menu)   FLAG_MENU="no" ;;
    --update|-u) FLAG_UPDATE="yes" ;;
    --uninstall) MODE="uninstall" ;;
    --wallpaper) WALLFILE="next" ;;
    --*) echo "unknown flag: $a (flags: --appimage, --menu, --no-menu, --update, --uninstall, --wallpaper FILE)"; exit 1 ;;
    *) if [ "$WALLFILE" = "next" ]; then WALLFILE="$a"; WALLFILE="got"
       elif [ "$WALLFILE" = "got" ]; then : ; fi ;;
  esac
done

say(){ printf '\033[1;32m🌿 %s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die(){ printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

command_exists(){ command -v "$1" >/dev/null 2>&1; }

ensure_wall(){
  if [ -f "$WALLFILE" ]; then
    cp -f "$WALLFILE" "$STREAMIO_HOME/wall.jpg"
    say "wallpaper planted: $WALLFILE → ~/.streamio/wall.jpg (Theme Studio → assets/wall.jpg)"
  fi
  if [ -f "$STREAMIO_HOME/wall.jpg" ]; then
    ln -sf "../../wall.jpg" "$STREAMIO_HOME/app/assets/wall.jpg" 2>/dev/null || true
  fi
}

install_launcher(){
  d="$HOME/.local/share/applications"; mkdir -p "$d"
  icon="$HOME/.local/share/icons/streamio.png"
  mkdir -p "$(dirname "$icon")"
  [ -f "$STREAMIO_HOME/app/assets/logo.png" ] && cp -f "$STREAMIO_HOME/app/assets/logo.png" "$icon"
  cat > "$d/streamio.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Streamio
GenericName=Media center
Comment=A media center for the forest 🌿
Exec=$1
Icon=$icon
Categories=AudioVideo;Video;Network;
Terminal=false
StartupWMClass=Streamio
EOF
  update-desktop-database "$d" 2>/dev/null || true
  say "launcher entry ready — look for 🌿 Streamio in your app grid / rofi"
}

fetch(){
  if command_exists curl; then curl -fSL --retry 3 -o "$2" "$1"
  elif command_exists wget;  then wget -qO "$2" "$1"
  else die "need curl or wget"; fi
}

# --------------------------------------------------- uninstall
if [ "$MODE" = "uninstall" ]; then
  if [ -f "$STREAMIO_HOME/.pid" ]; then kill "$(cat "$STREAMIO_HOME/.pid")" 2>/dev/null || true; fi
  if [ -f "$STREAMIO_HOME/.bpid" ]; then kill "$(cat "$STREAMIO_HOME/.bpid")" 2>/dev/null || true; fi
  pkill -f "$STREAMIO_HOME/server/index.js" 2>/dev/null || true
  rm -rf "$STREAMIO_HOME"
  rm -f  "$STREAMIO_BIN" "$HOME/.local/share/applications/streamio.desktop"
  say "uninstalled — the clearing is clean again 🍂"
  exit 0
fi

# --------------------------------------------------- appimage
if [ "$MODE" = "appimage" ]; then
  mkdir -p "$HOME/.local/bin" "$HOME/Applications"
  say "looking up the latest Streamio release…"
  json="$(fetch "https://api.github.com/repos/${STREAMIO_REPO}/releases/latest" -)" \
    || die "no release found yet — use the web install until one is published"
  url="$(printf '%s\n' "$json" | grep -oE '"browser_download_url": *"[^"]*\.AppImage"' | head -1 | sed -E 's/.*"(https[^"]*)"/\1/')"
  [ -n "$url" ] || die "the latest release has no AppImage asset"
  out="$HOME/Applications/Streamio.AppImage"
  say "downloading $out"
  fetch "$url" "$out"; chmod +x "$out"
  cat > "$STREAMIO_BIN" <<EOF
#!/bin/sh
exec "$out" "\$@"
EOF
  chmod +x "$STREAMIO_BIN"
  install_launcher "$out" "png"
  say "desktop install done — run: streamio  (or press the 🌿 in your launcher)"
  exit 0
fi

# --------------------------------------------------- web
say "installing Streamio web app → $STREAMIO_HOME"
command_exists python3 || command_exists python || command_exists node \
  || die "need python3, python or node to serve the app"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fetch "https://codeload.github.com/${STREAMIO_REPO}/tar.gz/refs/heads/${BRANCH}" "$tmp/streamio.tgz" \
  || die "could not fetch ${STREAMIO_REPO} (check the repo is public)"
tar -xzf "$tmp/streamio.tgz" -C "$tmp"
src="$(find "$tmp" -maxdepth 1 -type d ! -path "$tmp" | head -1)"
[ -n "$src" ] || die "downloaded archive looks wrong"

mkdir -p "$STREAMIO_HOME"
rm -rf "$STREAMIO_HOME/app.new" "$STREAMIO_HOME/app.old" "$STREAMIO_HOME/server.new" "$STREAMIO_HOME/server.old"
cp -r "$src" "$STREAMIO_HOME/app.new"
if [ -d "$STREAMIO_HOME/app" ]; then mv "$STREAMIO_HOME/app" "$STREAMIO_HOME/app.old"; fi
mv "$STREAMIO_HOME/app.new" "$STREAMIO_HOME/app"
rm -rf "$STREAMIO_HOME/app.old"
if [ -d "$src/server" ]; then
  cp -r "$src/server" "$STREAMIO_HOME/server.new"
  if [ -d "$STREAMIO_HOME/server" ]; then mv "$STREAMIO_HOME/server" "$STREAMIO_HOME/server.old"; fi
  mv "$STREAMIO_HOME/server.new" "$STREAMIO_HOME/server"
  rm -rf "$STREAMIO_HOME/server.old"
fi
ensure_wall

# ---- launcher: starts backend (torrents) + web server, opens the browser ----
mkdir -p "$HOME/.local/bin"
# make sure ~/.local/bin is on PATH now and for future shells
case ":$PATH:" in
  *":$HOME/.local/bin:"*) : ;;
  *) for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
       if [ -f "$rc" ] && ! grep -q 'HOME/.local/bin' "$rc" 2>/dev/null; then
         printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
       fi
     done
     export PATH="$HOME/.local/bin:$PATH"
     warn "$HOME/.local/bin was not on PATH — added it to your shell rc. Restart your terminal or run: export PATH=\$PATH:$HOME/.local/bin" ;;
esac

cat > "$STREAMIO_BIN" <<'LAUNCHER'
#!/usr/bin/env bash
# 🌿 streamio launcher — starts backend + web app together
export PATH="$HOME/.local/bin:$PATH"
STREAMIO_HOME="$HOME/.streamio"
PORT="${STREAMIO_PORT:-8477}"
BPORT="${STREAMIO_BACKEND_PORT:-7000}"

port_in_use() { curl -sf "http://127.0.0.1:$1/" >/dev/null 2>&1; }

case "${1:-}" in
  --port)         [ -n "${2:-}" ] && PORT="$2" ;;
  --backend-port) [ -n "${2:-}" ] && BPORT="$2" ;;
  --stop)
    for f in "$STREAMIO_HOME/.pid" "$STREAMIO_HOME/.bpid"; do
      [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
      rm -f "$f"
    done
    pkill -f "$STREAMIO_HOME/server/index.js" 2>/dev/null || true
    echo "streamio stopped (web + backend)"; exit 0 ;;
  --uninstall) exec bash -c 'curl -fsSL https://raw.githubusercontent.com/STREAMIO_REPO_PLACEHOLDER/main/install.sh | bash -s -- --uninstall' ;;
esac

# already awake?
if port_in_use "$PORT"; then
  echo "🐍 streamio web is already awake at http://127.0.0.1:$PORT"
  # make sure backend is also running
  if command -v node >/dev/null 2>&1 && [ -f "$STREAMIO_HOME/server/index.js" ] && [ -d "$STREAMIO_HOME/server/node_modules" ]; then
    if ! port_in_use "$BPORT"; then
      (cd "$STREAMIO_HOME/server" && PORT="$BPORT" exec node index.js) >"$STREAMIO_HOME/backend.log" 2>&1 &
      echo $! > "$STREAMIO_HOME/.bpid"
      for i in 1 2 3 4 5 6 7 8; do port_in_use "$BPORT" && break; sleep 0.4; done
      port_in_use "$BPORT" && echo "🌿 backend live → http://127.0.0.1:$BPORT" || echo "!! backend didn't start (see $STREAMIO_HOME/backend.log)"
    fi
  fi
  URL="http://127.0.0.1:$PORT"
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 &
  fi
  exit 0
fi

# start backend (optional, only if node + server/ exist)
if command -v node >/dev/null 2>&1 && [ -f "$STREAMIO_HOME/server/index.js" ]; then
  if [ ! -d "$STREAMIO_HOME/server/node_modules" ]; then
    (cd "$STREAMIO_HOME/server" && npm install --silent --no-audit --no-fund >/dev/null 2>&1) || true
  fi
  if [ -d "$STREAMIO_HOME/server/node_modules" ]; then
    if port_in_use "$BPORT"; then
      echo "🐍 backend already on :$BPORT"
    else
      (cd "$STREAMIO_HOME/server" && PORT="$BPORT" exec node index.js) \
        >"$STREAMIO_HOME/backend.log" 2>&1 &
      BPID=$!
      echo "$BPID" > "$STREAMIO_HOME/.bpid"
      for i in 1 2 3 4 5 6 7 8 9 10; do
        port_in_use "$BPORT" && break
        sleep 0.4
      done
      if port_in_use "$BPORT"; then
        echo "🌿 backend live → http://127.0.0.1:$BPORT"
      else
        echo "!! backend didn't start (see $STREAMIO_HOME/backend.log)"; tail -3 "$STREAMIO_HOME/backend.log" 2>/dev/null
      fi
    fi
  fi
fi

serve() {
  cd "$STREAMIO_HOME/app"
  if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT" --bind 127.0.0.1
  elif command -v python >/dev/null 2>&1;  then exec python  -m http.server "$PORT" --bind 127.0.0.1
  else exec node -e '
    const h=require("http"),f=require("fs"),p=require("path");
    process.chdir(process.argv[1]);
    h.createServer((q,s)=>{
      let p0=p.join(".",q.url.split("?")[0].replace(/^\\/+|\\/+\$/g,""));
      if(p0===".") p0="index.html";
      f.readFile(p0,(e,d)=>{ if(e){s.writeHead(404);s.end("lost in the forest")} else {
        const ext=p.extname(p0); const m={".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".woff2":"font/woff2",".json":"application/json"};
        s.writeHead(200, {"Content-Type": m[ext]||"application/octet-stream"}); s.end(d);
      }});
    }).listen(process.env.STREAMIO_PORT||8477,"127.0.0.1");' "$STREAMIO_HOME/app"
  fi
}

if port_in_use "$PORT"; then
  echo "✗ port $PORT is in use by another process."
  echo "  free it:  streamio --stop   or   lsof -ti:$PORT | xargs kill"
  exit 1
fi

serve &
PID=$!
echo "$PID" > "$STREAMIO_HOME/.pid"
for i in 1 2 3 4 5 6 7 8; do
  port_in_use "$PORT" && break
  sleep 0.4
done
if ! port_in_use "$PORT"; then
  echo "✗ web server failed to start on :$PORT"
  echo "  check: cat $STREAMIO_HOME/backend.log"
  rm -f "$STREAMIO_HOME/.pid"
  exit 1
fi
URL="http://127.0.0.1:$PORT"
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 &
fi
echo "🦋 streamio is live → $URL   (streamio --stop to fold the tent)"
wait "$PID"
LAUNCHER

sed -i "s#STREAMIO_REPO_PLACEHOLDER#${STREAMIO_REPO}#g" "$STREAMIO_BIN"
chmod +x "$STREAMIO_BIN"
case ":$PATH:" in *":$HOME/.local/bin:"*) : ;; *) warn "$HOME/.local/bin is not on your PATH — added it to your shell rc; restart your terminal or run: export PATH=\$PATH:$HOME/.local/bin";; esac

# ---- optional app-menu entry (on by default; skip with --no-menu) ----
if [ "$FLAG_MENU" != "no" ]; then
  install_launcher "$STREAMIO_BIN" "png"
fi

say "installed ✅"
cat <<EOF

   ─────────────  how to watch in the forest  ─────────────
     streamio                  # start + open the web app
     streamio --port 9000      # custom port
     streamio --stop           # stop the server
     streamio --uninstall      # remove everything
EOF
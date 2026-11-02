#!/bin/zsh
# 启动首帧采集：用隔离 STARRIS_HOME 启动当前 debug 二进制，连续截屏，
# 用于人工确认「窗口首次可见时是 splash/boot screen，而不是白屏」。
#
# 用法：zsh test/perf/startup-capture.sh [输出目录]
# 前置：没有其他星屿实例在跑；已构建 src-tauri/target/debug/starris-rust。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/tmp/perf/startup-$(date +%Y%m%dT%H%M%S)}"
APP="$OUT/Starris Startup.app"
HOME_DIR="$OUT/home"
BINARY="$ROOT/src-tauri/target/debug/starris-rust"

if pgrep -f "target/debug/starris-rust" >/dev/null 2>&1; then
  echo "已有星屿实例在运行，请先关闭再采集首帧。" >&2
  exit 2
fi
if [[ ! -x "$BINARY" ]]; then
  echo "缺少调试二进制：$BINARY（先跑一次 tauri build --debug --no-bundle）" >&2
  exit 2
fi

mkdir -p "$OUT/frames" "$HOME_DIR" "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.jh.starris</string>
<key>CFBundleName</key><string>Starris Startup</string>
<key>CFBundleExecutable</key><string>starris-startup</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST

cat > "$APP/Contents/MacOS/starris-startup" <<EOF
#!/bin/zsh
# 输出日志硬上限 200MiB，避免卡死时空转输出写满磁盘。
ulimit -f 409600
export STARRIS_HOME='$HOME_DIR'
exec '$BINARY' > '$OUT/app.log' 2>&1
EOF
chmod +x "$APP/Contents/MacOS/starris-startup"

open -n "$APP"
for index in {1..24}; do
  screencapture -x "$OUT/frames/frame-$(printf '%02d' "$index").png" 2>/dev/null || true
  sleep 0.08
done

pkill -f "$BINARY" >/dev/null 2>&1 || true
echo "$OUT"

#!/bin/bash
set -e

ICON_SOURCE="icon/icon-src.png"
ICONS_DIR="src-tauri/icons"
ICONSET_DIR="/tmp/backstamp.iconset"
PADDED_SOURCE="/tmp/backstamp_padded.png"

if [ ! -f "$ICON_SOURCE" ]; then
  echo "Error: icon source not found at $ICON_SOURCE"
  exit 1
fi

# Scale content to the macOS Tahoe safe area (826px within a 1024px canvas).
# Icons that fill the full 1024px appear oversized in the Tahoe dock.
echo "Applying Tahoe safe area (826px content on 1024px canvas)..."
SWIFT_SCRIPT=$(mktemp /tmp/pad_icon.XXXX.swift)
cat > "$SWIFT_SCRIPT" << 'SWIFT'
import AppKit

let src = CommandLine.arguments[1]
let out = CommandLine.arguments[2]
let canvasSize = 1024
let contentSize = 826
let offset = (canvasSize - contentSize) / 2

guard let img = NSImage(contentsOfFile: src) else {
    fputs("Error: could not load source image\n", stderr); exit(1)
}
let result = NSImage(size: NSSize(width: canvasSize, height: canvasSize))
result.lockFocus()
NSColor.clear.set()
NSRect(x: 0, y: 0, width: canvasSize, height: canvasSize).fill(using: .copy)
img.draw(in: NSRect(x: offset, y: offset, width: contentSize, height: contentSize))
result.unlockFocus()

let tiff = result.tiffRepresentation!
let rep = NSBitmapImageRep(data: tiff)!
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: out))
SWIFT

swift "$SWIFT_SCRIPT" "$ICON_SOURCE" "$PADDED_SOURCE"
rm "$SWIFT_SCRIPT"

# Use Tauri CLI for Android/iOS/Windows APPX/.ico formats.
# macOS-specific files (.icns + PNGs) are overwritten below.
echo "Generating Android/iOS/Windows formats..."
npx @tauri-apps/cli icon "$PADDED_SOURCE"

# Build .iconset using sips (macOS native color management, preserves Display P3)
echo "Building iconset with sips..."
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

resize() { sips -z "$1" "$1" "$PADDED_SOURCE" --out "$2" -s formatOptions best > /dev/null; }

resize 16  "$ICONSET_DIR/icon_16x16.png"
resize 32  "$ICONSET_DIR/icon_16x16@2x.png"
resize 32  "$ICONSET_DIR/icon_32x32.png"
resize 64  "$ICONSET_DIR/icon_32x32@2x.png"
resize 128 "$ICONSET_DIR/icon_128x128.png"
resize 256 "$ICONSET_DIR/icon_128x128@2x.png"
resize 256 "$ICONSET_DIR/icon_256x256.png"
resize 512 "$ICONSET_DIR/icon_256x256@2x.png"
resize 512 "$ICONSET_DIR/icon_512x512.png"
cp "$PADDED_SOURCE" "$ICONSET_DIR/icon_512x512@2x.png"

echo "Generating .icns with iconutil..."
iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/icon.icns"
rm -rf "$ICONSET_DIR" "$PADDED_SOURCE"

echo "Generating macOS PNG sizes with sips..."
resize_src() { sips -z "$1" "$1" "$ICON_SOURCE" --out "$2" -s formatOptions best > /dev/null; }
resize_src 32  "$ICONS_DIR/32x32.png"
resize_src 64  "$ICONS_DIR/64x64.png"
resize_src 128 "$ICONS_DIR/128x128.png"
resize_src 256 "$ICONS_DIR/128x128@2x.png"
resize_src 512 "$ICONS_DIR/icon.png"

echo "Clearing Rust build cache..."
rm -rf src-tauri/target/debug/build/backstamp-*
rm -f src-tauri/target/debug/Backstamp

echo "Clearing macOS icon cache (requires sudo)..."
sudo rm -rf /Library/Caches/com.apple.iconservices.store
sudo find /private/var/folders -name "com.apple.dock.iconcache" -delete 2>/dev/null || true

echo "Restarting Dock..."
killall Dock

echo "Done. Restart tauri dev to pick up the new icon."

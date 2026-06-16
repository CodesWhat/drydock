#!/usr/bin/env bash
#
# Regenerate every drydock brand asset (logo marks, favicons, PWA icons, OG cards)
# from a single master logo. Run after dropping a new master at the repo root.
#
#   bash scripts/regenerate-brand-assets.sh [path-to-master.png]
#
# Defaults to ./drydock.png. Requires ImageMagick 7 (`magick`).
#
# Filenames are intentionally preserved in place — never rename. docs/assets/whale-logo.png
# in particular is an external URL contract (Home Assistant entity_picture, app/triggers/
# providers/mqtt/Hass.ts); renaming it broke HASS once (CHANGELOG #138).
#
# NOT touched here (different brand / not the logo): the CodesWhat org logo
# (codeswhat-logo*), the selfhst/* third-party service icons, and app screenshots.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SRC="${1:-drydock.png}"
[ -f "$SRC" ] || {
	echo "master logo not found: $SRC" >&2
	exit 1
}
command -v magick >/dev/null 2>&1 || {
	echo "ImageMagick 'magick' is required" >&2
	exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. Wide transparent marks — preserve aspect, ~1041px wide (display size set by markup).
WIDE_MARKS=(
	ui/public/drydock-logo.png
	ui/src/assets/drydock.png
	apps/web/public/whale-logo.png
	docs/assets/whale-logo.png
	apps/web/public/docs/assets/whale-logo.png
	apps/web/public/docs/assets/assets/whale-logo.png
)
for f in "${WIDE_MARKS[@]}"; do
	[ -f "$f" ] || {
		echo "skip (absent): $f"
		continue
	}
	magick "$SRC" -resize 1041x -background none "$f"
	echo "wide   $f"
done

# Small inline UI mark (imported with ?inline → base64 in the bundle, keep it light).
if [ -f ui/src/assets/whale-logo.png ]; then
	magick "$SRC" -resize 256x -background none ui/src/assets/whale-logo.png
	echo "inline ui/src/assets/whale-logo.png"
fi

# 2. Dark-mode logo variant — negate RGB (blue→orange) preserving alpha, mirroring the
#    favicon.svg @media-dark invert(1). Derived from the one master, not a separate asset.
if [ -f docs/assets/whale-logo-dark.png ]; then
	magick "$SRC" -resize 1041x -channel RGB -negate +channel docs/assets/whale-logo-dark.png
	echo "dark   docs/assets/whale-logo-dark.png"
fi

# 3. Square icons — whale centered on white, ~8% padding (matches the apple-touch look).
make_square() { # size out
	local size="$1" out="$2" inner=$(($1 * 84 / 100))
	magick "$SRC" -resize "${inner}x${inner}" -background white -gravity center \
		-extent "${size}x${size}" "$out"
}
for base in ui/public apps/web/public apps/demo/public; do
	[ -f "$base/favicon-96x96.png" ] && make_square 96 "$base/favicon-96x96.png" && echo "sq96   $base/favicon-96x96.png"
	[ -f "$base/apple-touch-icon.png" ] && make_square 180 "$base/apple-touch-icon.png" && echo "apple  $base/apple-touch-icon.png"
	[ -f "$base/web-app-manifest-192x192.png" ] && make_square 192 "$base/web-app-manifest-192x192.png" && echo "pwa192 $base/web-app-manifest-192x192.png"
	[ -f "$base/web-app-manifest-512x512.png" ] && make_square 512 "$base/web-app-manifest-512x512.png" && echo "pwa512 $base/web-app-manifest-512x512.png"
	if [ -f "$base/favicon.ico" ]; then
		make_square 256 "$TMP/ico.png"
		magick "$TMP/ico.png" -define icon:auto-resize=16,32,48 "$base/favicon.ico"
		echo "ico    $base/favicon.ico"
	fi
done

# 4. OG social cards — whale centered on white, preserve aspect.
for f in apps/web/public/og-image.png apps/demo/public/og-image.png; do
	[ -f "$f" ] || continue
	magick "$SRC" -resize 1120x520 -background white -gravity center -extent 1280x640 "$f"
	echo "og     $f"
done

# 5. favicon.svg — base64-wrapped square raster, keeping the dark-mode invert filter.
make_svg() { # out
	make_square 256 "$TMP/svg.png"
	local b64
	b64="$(base64 <"$TMP/svg.png" | tr -d '\n')"
	cat >"$1" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256">
  <style>
    image { filter: none; }
    @media (prefers-color-scheme: dark) { image { filter: invert(1); } }
  </style>
  <image width="256" height="256" href="data:image/png;base64,${b64}"/>
</svg>
SVG
	echo "svg    $1"
}
for f in ui/public/favicon.svg apps/web/public/favicon.svg apps/demo/public/favicon.svg; do
	[ -f "$f" ] && make_svg "$f"
done

echo "Done."

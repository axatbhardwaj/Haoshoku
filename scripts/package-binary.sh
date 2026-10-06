#!/usr/bin/env bash
set -euo pipefail

arch=${1:-x64}
case "$arch" in
  x64|arm64) ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p -- "${2:-$root/dist}"
output=$(cd -- "${2:-$root/dist}" && pwd)
stage=$(mktemp -d "${TMPDIR:-/tmp}/haoshoku-package.XXXXXX")
trap 'rm -rf -- "${stage:?}"' EXIT

cd -- "$root"
bun build --compile --target="bun-linux-$arch" haoshoku.js --outfile "$stage/haoshoku"
cp -a -- configs common deskback icons "$stage/"
# KDE Connect launches this file through an external QML interpreter.
mkdir -p -- "$stage/src/helpers"
cp -- src/helpers/kde_connect_commands_writer.qml "$stage/src/helpers/"
tar -czf "$output/haoshoku-linux-$arch.tar.gz" -C "$stage" \
  haoshoku configs common deskback icons src

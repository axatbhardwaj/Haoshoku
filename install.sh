#!/usr/bin/env bash

main() {
  set -euo pipefail

  machine=$(uname -m)
  case "$machine" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "Unsupported architecture: $machine" >&2; exit 1 ;;
  esac

  install_home=${HAOSHOKU_HOME:-$HOME/.local/share/haoshoku}
  install_home=${install_home%/}
  base_url=${HAOSHOKU_BASE_URL:-https://github.com/axatbhardwaj/Haoshoku/releases/latest/download}
  tarball=${HAOSHOKU_TARBALL:-${base_url%/}/haoshoku-linux-$arch.tar.gz}
  parent=$(dirname -- "$install_home")
  mkdir -p -- "$parent" "$HOME/.local/bin"
  parent=$(cd -- "$parent" && pwd)
  install_home="$parent/$(basename -- "$install_home")"
  if [[ -e "$install_home" && ! -L "$install_home" ]]; then
    echo "Install destination is not an installer-managed symlink: $install_home" >&2
    exit 1
  fi

  # Unpack on the destination filesystem, then atomically swap a directory symlink.
  stage=$(mktemp -d "$parent/.haoshoku.XXXXXX")
  committed=false
  cleanup() {
    rm -f -- "${stage:?}.link"
    if [[ "$committed" == false ]]; then rm -rf -- "${stage:?}"; fi
  }
  trap cleanup EXIT
  if ! curl -fsSL "$tarball" > "$stage/archive.tar.gz"; then
    echo "Download failed: $tarball" >&2
    exit 1
  fi
  tar -xzf "$stage/archive.tar.gz" -C "$stage"
  rm -f -- "${stage:?}/archive.tar.gz"
  if [[ ! -x "$stage/haoshoku" ]]; then
    echo "Release archive is missing the haoshoku executable" >&2
    exit 1
  fi
  previous=$(readlink -- "$install_home" || true)
  ln -s -- "$stage" "$stage.link"
  mv -Tf -- "$stage.link" "$install_home"
  committed=true
  ln -sfn -- "$install_home/haoshoku" "$HOME/.local/bin/haoshoku"
  # Remove only a previous owned version created alongside this installation.
  if [[ "$previous" == "$parent/".haoshoku.* && -d "$previous" && ! -L "$previous" && -O "$previous" ]]; then
    suffix=${previous#"$parent/"}
    if [[ "$suffix" != */* ]]; then rm -rf -- "${previous:?}"; fi
  fi
  case ":${PATH:-}:" in
    *":$HOME/.local/bin:"*) ;;
    *) echo "Warning: $HOME/.local/bin is not on PATH; add it to your shell configuration." >&2 ;;
  esac
  echo "Installed Haoshoku: $HOME/.local/bin/haoshoku"
}

main "$@"

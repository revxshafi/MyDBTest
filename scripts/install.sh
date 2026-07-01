#!/usr/bin/env bash
# MyDBTest global installer for Linux and macOS

set -euo pipefail

REPO="https://github.com/revxshafi/MyDBTest"
INSTALL_DIR="$HOME/.mydbtest"
BIN_DIR="$HOME/.local/bin"
BIN_NAME="mydbtest"

G='\033[32m'; R='\033[31m'; Y='\033[33m'; C='\033[36m'; D='\033[2m'; X='\033[0m'

ok()   { echo -e "  [${G}  OK  ${X}] $*"; }
fail() { echo -e "  [${R} FAIL ${X}] $*"; }
run()  { echo -e "  [${C}  >>  ${X}] $*"; }
warn() { echo -e "  [${Y} WARN ${X}] $*"; }
info() { echo -e "  [${D} INFO ${X}] $*"; }

echo ""
info "MyDBTest installer"
echo ""

if [[ "${1:-}" == "--uninstall" ]]; then
  run "removing MyDBTest"
  rm -rf "$INSTALL_DIR"
  rm -f  "$BIN_DIR/$BIN_NAME"
  ok "MyDBTest removed"
  info "path entry in shell profiles was not touched — run 'mydbtest uninstall' to clean that too"
  echo ""
  exit 0
fi

if ! command -v git &>/dev/null; then
  fail "git is required to install MyDBTest"
  info "install git from https://git-scm.com and try again"
  exit 1
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  CURRENT_VER=""
  set +e
  CURRENT_VER="$(bash "$INSTALL_DIR/scripts/run.sh" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
  set -e
  run "updating existing installation${CURRENT_VER:+ (currently v$CURRENT_VER)}"
  if ! git -C "$INSTALL_DIR" pull --ff-only 2>&1; then
    fail "git pull failed — you may have local changes blocking the update"
    exit 1
  fi
else
  run "cloning into $INSTALL_DIR"
  if ! git clone "$REPO" "$INSTALL_DIR" 2>&1; then
    fail "git clone failed"
    # remove partial clone for next attempt
    rm -rf "$INSTALL_DIR"
    info "check your internet connection and try again"
    exit 1
  fi
fi

if command -v npm &>/dev/null; then
  run "installing npm dependencies"
  set +e
  npm install --prefix "$INSTALL_DIR" --silent 2>/dev/null || npm install --prefix "$INSTALL_DIR" 2>&1 | tail -3
  set -e
fi

mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/$BIN_NAME" << 'EOF'
#!/usr/bin/env bash
bash "$HOME/.mydbtest/scripts/run.sh" "$@"
EOF

chmod +x "$BIN_DIR/$BIN_NAME"
ok "wrapper written to $BIN_DIR/$BIN_NAME"

if ! command -v node &>/dev/null; then
  echo ""
  warn "node not found on PATH"
  info "it will be installed automatically on the first run of 'mydbtest'"
else
  set +e
  NODE_MAJOR="$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)"
  set -e
  if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
    warn "node v${NODE_MAJOR} detected — v20+ is required"
    info "run 'mydbtest --private-node' to install a private runtime"
  else
    ok "node v${NODE_MAJOR} detected"
  fi
fi

# Append the PATH export to a single profile file (creating it if needed).
# Sets PATCHED=1 so the caller knows at least one file changed.
_patch_file() {
  local profile="$1"

  mkdir -p "$(dirname "$profile")"

  if grep -qF "$BIN_DIR" "$profile" 2>/dev/null; then
    info "already configured: $profile"
    PATCHED=1
    return
  fi

  if [[ "$profile" == *config.fish ]]; then
    printf '\n%s\n' "fish_add_path $BIN_DIR  # added by MyDBTest installer" >> "$profile"
  else
    printf '\n%s\n' 'export PATH="$HOME/.local/bin:$PATH"  # added by MyDBTest installer' >> "$profile"
  fi

  ok "added $BIN_DIR to PATH in $profile"
  PATCHED=1
}

# Patch every profile file that the user's shell might read. A LOGIN shell
# (Termux, macOS Terminal) reads a login profile but NOT .bashrc; an
# interactive non-login shell (most Linux terminals) reads .bashrc but NOT
# .profile. To cover both we patch the interactive rc AND the login profile.
_patch_path() {
  case "${SHELL:-}" in
    */zsh)
      _patch_file "$HOME/.zshrc"                                 # interactive + login zsh
      [ -f "$HOME/.zprofile" ] && _patch_file "$HOME/.zprofile"
      ;;
    */fish)
      _patch_file "$HOME/.config/fish/config.fish"
      ;;
    *)
      _patch_file "$HOME/.bashrc"                                # interactive non-login bash
      # login bash reads the FIRST existing of these — patch that one so we
      # don't create a .bash_profile that shadows an existing .profile
      if [ -f "$HOME/.bash_profile" ]; then
        _patch_file "$HOME/.bash_profile"
      elif [ -f "$HOME/.bash_login" ]; then
        _patch_file "$HOME/.bash_login"
      else
        _patch_file "$HOME/.profile"                             # Termux / macOS login bash
      fi
      ;;
  esac
}

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  warn "$BIN_DIR is not on your PATH"
  PATCHED=0

  if [ -t 0 ]; then
    read -r -p "$(echo -e "  Add it to your shell profile automatically? [Y/n] ")" reply
    reply="${reply:-Y}"
    if [[ "$reply" =~ ^[Yy]$ ]]; then
      _patch_path
    fi
  else
    _patch_path
  fi

  if [ "$PATCHED" -eq 1 ]; then
    warn "restart your terminal, or run: source ~/.profile   (or ~/.bashrc / ~/.zshrc)"
  else
    info "add this line to your shell profile manually:"
    echo ""
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi

  echo ""
fi

export PATH="$BIN_DIR:$PATH"

set +e
INSTALLED_VER="$(bash "$BIN_DIR/$BIN_NAME" --version 2>/dev/null)"
set -e
if [[ "$INSTALLED_VER" == MyDBTest* ]]; then
  ok "$INSTALLED_VER — installed successfully"
  info "you can now run 'mydbtest' from this terminal"
  info "in THIS terminal, PATH isn't updated yet — open a new terminal, or run:"
  echo ""
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
else
  warn "could not verify installation — PATH may not be updated yet"
  info "fix: run this command, then try 'mydbtest' again:"
  echo ""
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
  info "to make it permanent, add that line to ~/.bashrc or ~/.profile "
fi

echo ""

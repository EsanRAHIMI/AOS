#!/usr/bin/env bash
# Build a minimal libXdamage.so.1 stub so Playwright's Chromium launches on a
# Linux host that lacks the library and has NO root/apt (e.g. a locked-down
# CI/sandbox). Headless Chromium never composites via the X Damage extension,
# so these 4 symbols are only needed for the dynamic loader; the stub is a
# benign no-op (QueryExtension returns False = "extension absent").
#
# Proven to launch real Chromium 149 headless in the AOS build sandbox (D-178d).
# On a normal machine prefer:  npx playwright install --with-deps chromium
#
# Usage:
#   bash e2e/sandbox-libs/build-xdamage-stub.sh /tmp/aos-stublibs
#   export LD_LIBRARY_PATH=/tmp/aos-stublibs:$LD_LIBRARY_PATH
#   export PW_CHROMIUM_PATH=$(ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-*/chrome-linux/headless_shell | head -1)
set -euo pipefail
OUT="${1:-/tmp/aos-stublibs}"
mkdir -p "$OUT"
SRC="$(mktemp --suffix=.c)"
cat > "$SRC" <<'EOF'
typedef unsigned long XID; typedef XID Damage; struct _XDisplay;
int  XDamageQueryExtension(struct _XDisplay *d,int *e,int *r){(void)d;if(e)*e=0;if(r)*r=0;return 0;}
Damage XDamageCreate(struct _XDisplay *d,XID w,int l){(void)d;(void)w;(void)l;return 0;}
void XDamageDestroy(struct _XDisplay *d,Damage m){(void)d;(void)m;}
void XDamageSubtract(struct _XDisplay *d,Damage m,XID rep,XID parts){(void)d;(void)m;(void)rep;(void)parts;}
EOF
gcc -shared -fPIC -Wl,-soname,libXdamage.so.1 -o "$OUT/libXdamage.so.1" "$SRC"
rm -f "$SRC"
echo "built $OUT/libXdamage.so.1"

#!/bin/bash
set -euo pipefail

mkdir -m 700 /tmp/home /tmp/scratch /tmp/repo /tmp/guards
python3 - <<'PY'
import os, pathlib, shutil, stat, subprocess

assert os.getuid() == 10001
status = pathlib.Path('/proc/self/status').read_text()
assert 'CapEff:\t0000000000000000' in status and 'NoNewPrivs:\t1' in status
assert set(os.listdir('/sys/class/net')) == {'lo'}
assert os.statvfs('/').f_flag & os.ST_RDONLY
for name in ['/tmp/home', '/tmp/scratch', '/tmp/repo', '/tmp/guards']:
    path = pathlib.Path(name)
    assert path.resolve() == path and path.stat().st_uid == os.getuid()
    assert stat.S_IMODE(path.stat().st_mode) == 0o700
for name in ['/run/tailscale/tailscaled.sock', '/var/run/tailscale/tailscaled.sock', '/var/run/docker.sock']:
    assert not pathlib.Path(name).exists()
assert not any(key in os.environ for key in ['T3CODE_HOME', 'OP_SERVICE_ACCOUNT_TOKEN', 'SSH_AUTH_SOCK', 'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN'])
for name in ['git', 'node', 'npm', 'bun', 'python3', 'lua', 'jq', 'curl', 'ssh']:
    assert shutil.which(name), name
assert subprocess.check_output(['bun', '--version'], text=True).strip() == '1.4.2'
print('RUNTIME ISOLATION PASS: nonroot, no capabilities, read-only root, loopback only, owned 0700 scratch', flush=True)
PY

# These commands must fail even when a fixture intentionally uses the real runner.
printf '#!/bin/sh\nexit 1\n' > /tmp/guards/tailscale
cp /tmp/guards/tailscale /tmp/guards/gh
chmod 755 /tmp/guards/tailscale /tmp/guards/gh
export PATH=/tmp/guards:/usr/local/bin:/usr/bin:/bin
python3 - <<'PY'
import shutil, subprocess
for name in ['tailscale', 'gh']:
    assert shutil.which(name) == '/tmp/guards/' + name
    assert subprocess.run([name]).returncode == 1
print('EXTERNAL COMMAND GUARDS PASS', flush=True)
PY
cp -R /opt/haoshoku/. /tmp/repo/
export NODE_PATH=/tmp/repo/node_modules npm_config_cache=/tmp/home/npm-cache npm_config_offline=true
cd /tmp/repo
git init -q
git add .
bun test

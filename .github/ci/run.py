"""Create, inspect, then start the test container; never forward host environment."""

import json
import subprocess
import sys


def inspect(*args):
    return json.loads(subprocess.check_output(["docker", *args], text=True))[0]


def require(condition, message):
    if not condition:
        raise SystemExit(message)


image = inspect("image", "inspect", sys.argv[1])
container = subprocess.check_output([
    "docker", "create", "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "3g",
    "--cpus", "2", "--tmpfs", "/tmp:rw,exec,nosuid,size=2g,mode=1777",
    "--user", "10001:10001", image["Id"],
], text=True).strip()
info = inspect("inspect", container)
# Save the complete configuration in the job log before any test process starts.
print(json.dumps({"image": image["Id"], "prestart": info}, indent=2), flush=True)
host, config = info["HostConfig"], info["Config"]
require(info["State"]["Status"] == "created" and info["Image"] == image["Id"], "Image/state mismatch")
require(host["NetworkMode"] == "none" and host["ReadonlyRootfs"] and not host["Privileged"], "Unsafe network/root")
require(host["CapDrop"] == ["ALL"] and not host["CapAdd"] and host["SecurityOpt"] == ["no-new-privileges"], "Unsafe privileges")
require(host["PidsLimit"] == 256 and host["Memory"] == 3221225472 and host["NanoCpus"] == 2000000000, "Missing resource limits")
require(host["Tmpfs"] == {"/tmp": "rw,exec,nosuid,size=2g,mode=1777"}, "Unsafe scratch")
require(host["PidMode"] == "" and host["IpcMode"] == "private" and host["CgroupnsMode"] == "private", "Shared namespaces")
require(not info["Mounts"] and not config["Volumes"], "Runtime mounts forbidden")
require(not any(host.get(key) for key in ["Binds", "Devices", "DeviceRequests", "VolumesFrom", "ExtraHosts", "Links", "PortBindings", "GroupAdd"]), "Host access forbidden")
require(config["User"] == "10001:10001" and not host["AutoRemove"], "Wrong user/retention")
require(config["Entrypoint"] == ["/bin/bash", "/opt/haoshoku/.github/ci/run-suite.sh"] and not config["Cmd"], "Unexpected command")
require(config["Env"] == image["Config"]["Env"], "Forwarded environment forbidden")
require(set(item.split("=", 1)[0] for item in config["Env"]) <= {"PATH", "LANG", "GPG_KEY", "PYTHON_VERSION", "PYTHON_SHA256", "HOME", "TMPDIR"}, "Unexpected image environment")
print("PRESTART ISOLATION PASS", flush=True)
attached = subprocess.run(["docker", "start", "--attach", container]).returncode
code = int(subprocess.check_output(["docker", "wait", container], text=True))
state = inspect("inspect", container)["State"]
print(json.dumps({"container": container, "state": state, "retained": True}), flush=True)
require(state["Status"] == "exited" and not state["OOMKilled"], "Abnormal test completion")
raise SystemExit(code or attached)

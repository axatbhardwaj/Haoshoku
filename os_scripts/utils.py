import logging
import subprocess
import shlex

log = logging.getLogger("bankai")


def command_exists(command):
    """Check if a command exists."""
    return (
        subprocess.run(
            f"command -v {command}", shell=True, capture_output=True
        ).returncode
        == 0
    )


def run_command(command, cwd=None):
    """
    Runs a command, streaming its output to the logger in real-time.
    """
    log.info(f"[dim]Executing: {command}[/dim]")
    try:
        process = subprocess.Popen(
            shlex.split(command),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=cwd,
        )

        with process.stdout:
            for line in iter(process.stdout.readline, ""):
                log.info(line.strip())

        returncode = process.wait()
        if returncode != 0:
            log.warning(f"Command '{command}' exited with code {returncode}")
            return False
        return True

    except FileNotFoundError:
        log.error(f"Command not found for: '{command}'")
        return False
    except Exception as e:
        log.error(f"An unexpected error occurred while running '{command}': {e}")
        return False

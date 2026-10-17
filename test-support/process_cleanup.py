"""Bounded cleanup of the process owned by an updater integration fixture."""
import os
import subprocess


def stop_fixture_process(process, *, windows=None, runner=None):
    if process.poll() is not None:
        return
    windows = os.name == 'nt' if windows is None else windows
    stopped = None
    if windows:
        runner = subprocess.run if runner is None else runner
        stopped = runner(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                         capture_output=True, text=True, timeout=10)
    else:
        process.terminate()
    try:
        # taskkill can report already-exited children while the root's exit is
        # still being delivered. The owned process's bounded wait is authoritative.
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if stopped is not None and stopped.returncode:
            raise RuntimeError(stopped.stdout + stopped.stderr)
        process.kill()
        process.wait(timeout=5)

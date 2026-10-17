"""Read a complete installer-test result without racing a writer's file lock.
The caller owns the deadline and retries; this performs only one read.
"""
import json

def read_complete_marker(path):
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except (OSError, json.JSONDecodeError):
        return None

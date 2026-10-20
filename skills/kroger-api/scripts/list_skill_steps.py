#!/usr/bin/env python3
"""List all playbook names and their steps within this skill.

Outputs in the format:
# [playbook-name]
## [Step-n] [Step-description]

Usage:
    python list_skill_steps.py
"""

import re
import sys
import argparse
from pathlib import Path


def extract_playbook_steps(playbook_path):
    """Extract step numbers and descriptions from a playbook file."""
    content = playbook_path.read_text(encoding='utf-8')
    
    # Find all ## Step headings
    step_pattern = re.compile(r'^## Step (\d+[a-z]?)[.:]?\s+(.+?)\s*$', re.MULTILINE | re.IGNORECASE)
    steps = []
    
    for match in step_pattern.finditer(content):
        step_num = match.group(1)
        step_desc = match.group(2).strip()
        steps.append((step_num, step_desc))
    
    return steps


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    skill_path = Path(__file__).resolve().parent.parent
    playbooks_dir = skill_path / 'playbooks'
    
    if not playbooks_dir.exists():
        print("No playbooks directory found")
        return 1
    
    playbook_files = sorted(playbooks_dir.glob('*.md'))
    
    if not playbook_files:
        print("No playbooks found")
        return 1
    
    for playbook in playbook_files:
        # Output playbook name without .md extension
        playbook_name = playbook.stem
        print(f"# {playbook_name}")
        
        try:
            steps = extract_playbook_steps(playbook)
            for step_num, step_desc in steps:
                print(f"## Step {step_num} {step_desc}")
        except Exception as e:
            print(f"[ERROR] Failed to parse {playbook.name}: {e}")
            return 1
        
        print()
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

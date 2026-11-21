"""Regression tests for the manual Android APK workflow release switch."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/android-apk.yml"


def release_request_script():
    """Extract the Bash step actually used by GitHub Actions (no YAML dependency)."""
    lines = WORKFLOW.read_text(encoding="utf-8").splitlines()
    start = lines.index("      - name: Resolve release request")
    run = lines.index("        run: |", start + 1)
    end = next(
        (i for i in range(run + 1, len(lines)) if lines[i].startswith("      - name: ")),
        len(lines),
    )
    return "\n".join(line[10:] if line.startswith("          ") else line
                     for line in lines[run + 1:end]) + "\n"


class AndroidWorkflowDispatchTest(unittest.TestCase):
    def execute(self, *, event, manual_publish, ref):
        with tempfile.TemporaryDirectory(prefix="cortex-apk-gate-") as folder:
            output = Path(folder) / "outputs.txt"
            env = {**os.environ, "EVENT": event, "MANUAL_PUBLISH": manual_publish,
                   "GITHUB_REF": ref, "GITHUB_OUTPUT": str(output)}
            process = subprocess.run(
                ["bash", "-e", "-o", "pipefail", "-c", release_request_script()],
                cwd=ROOT, env=env, text=True, capture_output=True, check=False,
            )
            return process, output.read_text() if output.exists() else ""

    def test_manual_build_is_not_a_republish(self):
        process, result = self.execute(
            event="workflow_dispatch", manual_publish="false", ref="refs/heads/main"
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertIn("publish=false\n", result)

    def test_explicit_manual_publish_still_supported_on_main(self):
        process, result = self.execute(
            event="workflow_dispatch", manual_publish="true", ref="refs/heads/main"
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertIn("publish=true\n", result)

    def test_manual_publish_not_allowed_from_feature_branch(self):
        process, result = self.execute(
            event="workflow_dispatch", manual_publish="true", ref="refs/heads/feature"
        )
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("only be published from main", process.stdout)
        self.assertEqual(result, "")

    def test_manual_build_allowed_on_feature_branch(self):
        process, result = self.execute(
            event="workflow_dispatch", manual_publish="false", ref="refs/heads/feature"
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertIn("publish=false\n", result)


if __name__ == "__main__":
    unittest.main()

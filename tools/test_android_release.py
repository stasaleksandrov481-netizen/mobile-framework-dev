import copy
import pathlib
import subprocess
import tempfile
import unittest

from android_release import Release, read_release, validate_publish, verify_response


def gradle(version="1.0.18-beta.3", code=120):
    return f'    versionCode = {code}\n    versionName = "{version}"\n'


class AndroidReleaseTest(unittest.TestCase):
    def test_parse_stable_and_beta_metadata(self):
        self.assertEqual(read_release(gradle()), Release("1.0.18-beta.3", 120))
        self.assertFalse(read_release(gradle("1.0.19", 121)).prerelease)
        self.assertEqual(read_release(gradle()).name, "CORTEX-1.0.18-beta.3.apk")

    def test_reject_invalid_or_ambiguous_metadata(self):
        for source in (gradle(code=0), gradle(code=2_100_000_001), gradle("1.0.18-beta.0"),
                       gradle("../bad"), gradle() + gradle(), "versionCode = dynamic\n"):
            with self.subTest(source=source), self.assertRaises(ValueError):
                read_release(source)

    def repository(self):
        folder = tempfile.TemporaryDirectory(prefix="cortex-release-test-")
        self.addCleanup(folder.cleanup)
        root = pathlib.Path(folder.name)
        def run(*args):
            return subprocess.run(["git", "-C", str(root), *args], check=True,
                                  capture_output=True, text=True).stdout.strip()
        run("init")
        run("config", "user.name", "Release test")
        run("config", "user.email", "release-test@example.invalid")
        (root / "app").mkdir()
        (root / "app/build.gradle.kts").write_text(gradle("1.0.18-beta.1", 118))
        run("add", ".")
        run("commit", "-m", "Published baseline")
        baseline = run("rev-parse", "HEAD")
        run("tag", "v1.0.18-beta.1")
        (root / "app/build.gradle.kts").write_text(gradle())
        run("commit", "-am", "New build")
        return root, run, baseline, run("rev-parse", "HEAD")

    def test_reproduces_old_tag_conflict_before_any_build(self):
        root, _, _, head = self.repository()
        with self.assertRaisesRegex(ValueError, "already points to a different commit"):
            validate_publish(Release("1.0.18-beta.1", 118), head, root)

    def test_new_version_is_accepted_without_moving_old_tag(self):
        root, run, baseline, head = self.repository()
        validate_publish(Release("1.0.18-beta.3", 120), head, root, ["v1.0.18-beta.1"])
        self.assertEqual(run("rev-parse", "v1.0.18-beta.1"), baseline)

    def test_republishing_exact_same_commit_is_accepted(self):
        root, _, baseline, _ = self.repository()
        validate_publish(Release("1.0.18-beta.1", 118), baseline, root, ["v1.0.18-beta.1"])

    def test_lower_or_equal_version_code_cannot_be_released_as_a_new_version(self):
        root, _, _, head = self.repository()
        for code in (117, 118):
            with self.subTest(code=code), self.assertRaisesRegex(ValueError, "must exceed published"):
                validate_publish(Release("1.0.18-beta.3", code), head, root, ["v1.0.18-beta.1"])

    def response(self, release):
        return {"tag_name": release.tag, "draft": False, "prerelease": release.prerelease,
                "assets": [{"name": release.name, "state": "uploaded", "size": 18_000_000},
                           {"name": "SHA256SUMS.txt", "state": "uploaded", "size": 90}]}

    def test_beta_verifies_by_its_own_tag_without_using_stable_latest(self):
        release = Release("1.0.18-beta.3", 120)
        verify_response(release, self.response(release), "a" * 40, "a" * 40)

    def test_reject_wrong_commit_channel_incomplete_or_duplicate_assets(self):
        release = Release("1.0.18-beta.3", 120)
        original = self.response(release)
        mutations = [{"tag_name": "v1.0.17"}, {"draft": True}, {"prerelease": False},
                     {"assets": original["assets"][:1]},
                     {"assets": original["assets"] + [original["assets"][0]]},
                     {"assets": [{**asset, "size": 0} for asset in original["assets"]]}]
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                verify_response(release, {**copy.deepcopy(original), **mutation}, "a" * 40, "a" * 40)
        with self.assertRaisesRegex(ValueError, "built commit"):
            verify_response(release, original, "a" * 40, "b" * 40)


if __name__ == "__main__":
    unittest.main()

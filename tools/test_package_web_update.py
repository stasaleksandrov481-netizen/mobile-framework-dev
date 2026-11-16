import base64
import hashlib
import json
import pathlib
import subprocess
import tempfile
import unittest
import zipfile

from package_web_update import package, REQUIRED


class SignedWebUpdateTest(unittest.TestCase):
    def test_signed_bundle_validates_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory(prefix="cortex-web-update-test-") as folder:
            root = pathlib.Path(folder)
            private = root / "private.pem"
            public = root / "public.pem"
            subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072",
                            "-out", str(private)], check=True, capture_output=True)
            subprocess.run(["openssl", "pkey", "-in", str(private), "-pubout", "-out", str(public)],
                           check=True, capture_output=True)
            output = root / "release"
            package(2026111601, 112, private, output)
            manifest_bytes = (output / "manifest.json").read_bytes()
            manifest = json.loads(manifest_bytes)
            archive = (output / manifest["archive"]).read_bytes()
            self.assertEqual(manifest["sha256"], hashlib.sha256(archive).hexdigest())
            self.assertEqual(manifest["size"], len(archive))
            with zipfile.ZipFile(output / manifest["archive"]) as files:
                self.assertTrue(REQUIRED.issubset(set(files.namelist())))
                self.assertTrue(all(not name.startswith("/") and ".." not in name.split("/")
                                    for name in files.namelist()))
            signature = root / "signature.bin"
            signature.write_bytes(base64.b64decode((output / "manifest.sig").read_text()))
            verify = ["openssl", "dgst", "-sha256", "-verify", str(public), "-signature", str(signature)]
            good = subprocess.run(verify, input=manifest_bytes, capture_output=True)
            self.assertEqual(good.returncode, 0)
            tampered = subprocess.run(verify, input=manifest_bytes.replace(b"2026111601", b"2026111602"),
                                      capture_output=True)
            self.assertNotEqual(tampered.returncode, 0)

    def test_invalid_version_rejected(self):
        with self.assertRaises(ValueError):
            package(-1, 112, pathlib.Path("no-key"), pathlib.Path("no-output"))

    def test_release_archive_is_reproducible(self):
        with tempfile.TemporaryDirectory(prefix="cortex-web-update-repro-") as folder:
            root = pathlib.Path(folder)
            private = root / "private.pem"
            subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072",
                            "-out", str(private)], check=True, capture_output=True)
            package(2026111602, 112, private, root / "first")
            package(2026111602, 112, private, root / "second")
            for name in ("manifest.json", "manifest.sig", "web-v2026111602.zip"):
                self.assertEqual((root / "first" / name).read_bytes(), (root / "second" / name).read_bytes())


if __name__ == "__main__":
    unittest.main()

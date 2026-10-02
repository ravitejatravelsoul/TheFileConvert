"""LibreOffice (headless) as an independent document renderer — QA only, never part of the product.

    LIBREOFFICE=path/to/soffice.exe python qa/validate/lo.py pdf OUTDIR file.docx [file2.docx ...]

Converts each file to PDF in OUTDIR with a throwaway user profile. Used to render .docx files the way a
real word processor would (for PDF -> Word checks) and to make realistic PDFs from Word documents.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def soffice() -> str:
    path = os.environ.get("LIBREOFFICE")
    if not path or not Path(path).exists():
        sys.exit("Set LIBREOFFICE to soffice.exe (a portable copy is fine — see qa/FIDELITY_AUDIT.md).")
    return path


def convert(fmt: str, outdir: str, files: list[str]) -> None:
    os.makedirs(outdir, exist_ok=True)
    profile = Path(tempfile.gettempdir()) / "tfc-lo-profile"
    args = [soffice(), f"-env:UserInstallation={profile.as_uri()}", "--headless", "--norestore", "--convert-to", fmt, "--outdir", str(Path(outdir).resolve())]
    args += [str(Path(f).resolve()) for f in files]
    subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=900)


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2], sys.argv[3:])

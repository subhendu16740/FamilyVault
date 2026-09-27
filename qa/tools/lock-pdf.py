"""Encrypt a PDF with a user password, for the locked-statement fixture.

    python3 lock-pdf.py plain.pdf locked.pdf PASSWORD

RC4-128 rather than AES because pypdf implements it without extra crypto
packages, and PDF.js (what the server reads PDFs with) opens both. A USER
password is set, not just an owner password: an owner-only PDF opens without
asking, which would not test the locked case at all.
"""

import sys

from pypdf import PdfReader, PdfWriter

src, dst, password = sys.argv[1:4]
writer = PdfWriter(clone_from=PdfReader(src))
writer.encrypt(user_password=password, owner_password=password + "-owner", algorithm="RC4-128")
with open(dst, "wb") as handle:
    writer.write(handle)

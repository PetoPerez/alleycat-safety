"""Reads the first sheet of an .xlsx with the standard library: the file is a zip of XML parts."""
import io
import re
import zipfile
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
MAX_XML_BYTES = 20 * 1024 * 1024  # uncompressed; a roster is a few KB, this only stops zip bombs


class SpreadsheetError(ValueError):
    pass


def _xml(archive: zipfile.ZipFile, name: str):
    info = archive.getinfo(name)
    if info.file_size > MAX_XML_BYTES:
        raise SpreadsheetError("Spreadsheet is too large")
    data = archive.read(info)
    if b"<!DOCTYPE" in data:  # no entity tricks in a spreadsheet we accept
        raise SpreadsheetError("Not a valid .xlsx file")
    return ElementTree.fromstring(data)


def _text(node) -> str:
    return "".join(t.text or "" for t in node.iter(f"{{{NS['m']}}}t"))


def _number(value: str) -> str:
    """Phones typed as numbers come back as 5512345678 or 5.512345678E9: show them as digits."""
    try:
        number = Decimal(value)
    except InvalidOperation:
        return value
    return str(int(number)) if number == number.to_integral_value() else format(number, "f")


def _column(ref: str) -> int:
    index = 0
    for letter in re.match(r"[A-Z]+", ref).group():
        index = index * 26 + ord(letter) - 64
    return index - 1


def rows(content: bytes) -> list[list[str]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        workbook = _xml(archive, "xl/workbook.xml")
        rels = _xml(archive, "xl/_rels/workbook.xml.rels")
        sheet_id = workbook.find("m:sheets/m:sheet", NS).get(f"{{{NS['r']}}}id")
        target = next(r.get("Target") for r in rels.findall("rel:Relationship", NS) if r.get("Id") == sheet_id)
        path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
        shared = [_text(si) for si in _xml(archive, "xl/sharedStrings.xml").findall("m:si", NS)] \
            if "xl/sharedStrings.xml" in archive.namelist() else []
        sheet = _xml(archive, path)
    except SpreadsheetError:
        raise
    except Exception:  # not a zip, missing parts, malformed XML: all the same to the organizer
        raise SpreadsheetError("Not a valid .xlsx file")
    table = []
    for row in sheet.iterfind(".//m:sheetData/m:row", NS):
        cells: dict[int, str] = {}
        for cell in row.findall("m:c", NS):
            kind, value = cell.get("t"), cell.find("m:v", NS)
            if kind == "inlineStr":
                text = _text(cell)
            elif value is None or value.text is None:
                continue
            elif kind == "s":
                text = shared[int(value.text)]
            elif kind in ("str", "b", "e"):
                text = value.text
            else:
                text = _number(value.text)
            ref = cell.get("r")  # some generators omit it: then cells are consecutive
            cells[_column(ref) if ref else max(cells, default=-1) + 1] = text.strip()
        table.append([cells.get(i, "") for i in range(max(cells) + 1)] if cells else [])
    return table

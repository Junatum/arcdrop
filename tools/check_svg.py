#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Validate the bundled SVG without requiring external or network tools."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / 'web/icon.svg'
NS = '{http://www.w3.org/2000/svg}'
ALLOWED_LINK = re.compile(r'^url\(#[A-Za-z0-9_-]+\)$')


def main() -> None:
    root = ET.parse(SVG).getroot()
    if root.tag != NS + 'svg':
        raise SystemExit('FAIL: SVG 루트가 올바르지 않습니다')
    ids = set()
    for elem in root.iter():
        tag = elem.tag.rsplit('}', 1)[-1]
        if tag in {'script', 'foreignObject', 'image', 'iframe'}:
            raise SystemExit('FAIL: SVG 외부 또는 실행 가능 요소가 발견되었습니다')
        identifier = elem.get('id')
        if identifier:
            if identifier in ids:
                raise SystemExit('FAIL: 중복 SVG id가 발견되었습니다')
            ids.add(identifier)
        for key, value in elem.attrib.items():
            attr = key.rsplit('}', 1)[-1]
            if attr.lower().startswith('on') or attr.lower() in {'href', 'src'}:
                raise SystemExit('FAIL: SVG 외부 참조 또는 이벤트 속성이 발견되었습니다')
            if value.startswith('url(') and not ALLOWED_LINK.fullmatch(value):
                raise SystemExit('FAIL: SVG의 내부 그라디언트 참조가 올바르지 않습니다')
    print('PASS: ArcDrop SVG XML 문법, 로컬 참조 및 비실행 계약')


if __name__ == '__main__':
    main()

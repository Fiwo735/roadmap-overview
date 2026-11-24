# Shapes "Vanagram" with HarfBuzz (kerning on) and dumps glyph outlines from Inter SemiBold (SIL OFL 1.1: see ../LICENSE-Inter.txt).
import json, os, uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

HERE = os.path.dirname(os.path.abspath(__file__))
INTER_DIR = os.environ.get('INTER_DIR', '/usr/share/fonts/opentype/inter')

def build(weight, track):
    path = os.path.join(INTER_DIR, f'Inter-{weight}.otf')
    face = hb.Face(hb.Blob.from_file_path(path)); font = hb.Font(face)
    tt = TTFont(path); gs = tt.getGlyphSet(); upm = tt['head'].unitsPerEm
    buf = hb.Buffer(); buf.add_str('Vanagram'); buf.guess_segment_properties()
    hb.shape(font, buf, {'kern': True})
    out, x = [], 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        g = gs[font.glyph_to_string(info.codepoint)]
        p = SVGPathPen(gs); g.draw(p); b = BoundsPen(gs); g.draw(b)
        out.append({'x': x + pos.x_offset, 'd': p.getCommands(), 'bounds': b.bounds})
        x += pos.x_advance + track * upm
    return {'upm': upm, 'capH': tt['OS/2'].sCapHeight, 'xH': tt['OS/2'].sxHeight,
            'glyphs': out, 'adv': x - track * upm, 'font': f'Inter {weight}',
            'license': 'Outlines of Inter glyphs, Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter), SIL Open Font License 1.1: see ../LICENSE-Inter.txt'}

json.dump(build('SemiBold', -0.012), open(os.path.join(HERE, 'wordmark-semibold.json'), 'w'))
print('ok')

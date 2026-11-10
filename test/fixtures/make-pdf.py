"""Maakt een nep-paklijst in Top Brands-opmaak (verzonnen gegevens) voor de tests."""
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

out = sys.argv[1] if len(sys.argv) > 1 else 'paklijst-topbrands-test.pdf'
c = canvas.Canvas(out, pagesize=A4)
W, H = A4
def t(x, y, s, size=9, font='Helvetica'):
    c.setFont(font, size); c.drawString(x, H - y, s)
R = 330
t(R, 60, 'PACKING LIST', 14, 'Helvetica-Bold')
for i, s in enumerate(['Topbrands Europe BV', 'Aston Martinlaan 1', '3261 NB Oud-Beijerland', 'The Netherlands']):
    t(R, 85 + i * 11, s)
rows = [('K9999999', 'Phone No.    +31 000 000 000'), ('Voorbeeld Retail GmbH (DE)', 'Fax No.    +31 000 000 001'),
        ('Teststrasse 12', 'VAT Reg. No.    NL000000000B01'), ('', 'Bank:    Testbank'), ('12345 Teststadt', 'Account No.    00.00.00.000'), ('Deutschland', '')]
for i, (l, r) in enumerate(rows):
    if l: t(40, 150 + i * 11, l)
    if r: t(R, 150 + i * 11, r)
t(40, 240, 'Customer number:'); t(150, 240, 'K9999999'); t(R, 240, 'Date'); t(420, 240, '3-10-2026')
t(40, 255, 'Your reference:'); t(150, 255, 'SHIP ID: 7654321 / 4000000001'); t(R, 255, 'Order No.'); t(420, 255, '26SO999-000123')
t(40, 300, 'Art No.'); t(100, 300, 'Description'); t(420, 300, 'Total QTY')
t(40, 315, '1234567'); t(100, 315, 'Testartikel Shower Gel 500ml'); t(420, 315, '1200')
t(100, 360, '8.120kg 21 pallets'); t(330, 360, 'Total boxes'); t(420, 360, '980')
c.save()

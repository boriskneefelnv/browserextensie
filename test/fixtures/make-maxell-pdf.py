"""Maakt een nep-pickinglijst in Maxell-opmaak (verzonnen afnemer/gegevens) voor de tests."""
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

out = sys.argv[1]
c = canvas.Canvas(out, pagesize=A4)
W, H = A4
def t(x, y, s, size=9, font='Helvetica'):
    c.setFont(font, size); c.drawString(x, H - y, s)
t(40, 50, 'Maxell Europe Limited', 11, 'Helvetica-Bold'); t(330, 50, 'Picking List MEL-PL009999', 11, 'Helvetica-Bold')
for i, s in enumerate(['Voorbeeldpark 1,', 'Testweg,', 'Slough,', 'Berkshire SL0 0AA', 'Ph: +00 44 1000 200300 , Fax: +00 44 1000 200301,', 'Web: http://www.example.com,', 'Email: verkoop@example.com']):
    t(40, 64 + i * 11, s)
t(40, 160, 'Customer')
t(330, 172, 'Picking route'); t(440, 172, 'MEL-PL009999')
t(52, 184, 'TESTWINKEL Supers B.V'); t(330, 184, 'Orderer')
t(52, 196, 'Goederenontvangst'); t(330, 196, 'Activation date'); t(440, 196, '05/11/2026')
t(52, 208, 'Proefstraat 7'); t(330, 208, 'End date/time')
t(52, 220, '1234 AB PROEFSTAD'); t(330, 220, 'Mode of delivery'); t(440, 220, 'TRUCK')
t(52, 232, 'Netherlands'); t(330, 232, 'Delivery terms'); t(440, 232, 'DDP')
t(330, 250, 'Page'); t(440, 250, '1 of 1')
t(40, 290, 'Item number'); t(140, 290, 'Description'); t(260, 290, 'Order unit'); t(470, 290, 'Quantity')
t(40, 305, '700001.262.NL'); t(140, 305, 'TEST BATTERIJ 8PK'); t(260, 305, 'PACK'); t(470, 305, '1200')
t(260, 320, 'Customer PO'); t(340, 320, 'PO: 100001')
t(40, 332, 'Warehouse:'); t(100, 332, 'NLD'); t(260, 332, 'Order number'); t(340, 332, 'MEL-SO000001')
t(40, 400, 'Receipt'); t(40, 420, 'Packages'); t(130, 420, 'Pallet Qty'); t(220, 420, 'Net weight'); t(220, 435, '1,234.50 Kg')
c.save()

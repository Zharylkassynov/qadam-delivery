from pathlib import Path
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT=Path(r'C:/Users/zhary/OneDrive/Desktop/Qadam Delivery')
OUT=ROOT/'output/pdf/Qadam_Task5_Team_Guide_RU.pdf'
for name,fn in [('Arial','arial.ttf'),('Arial-Bold','arialbd.ttf'),('Arial-Italic','ariali.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(Path('C:/Windows/Fonts')/fn)))
pdfmetrics.registerFontFamily('Arial',normal='Arial',bold='Arial-Bold',italic='Arial-Italic',boldItalic='Arial-Bold')
ink=colors.HexColor('#153346');blue=colors.HexColor('#2654E8');muted=colors.HexColor('#536B83')
styles={
 'title':ParagraphStyle('title',fontName='Arial-Bold',fontSize=22,leading=26,textColor=ink,spaceAfter=8),
 'sub':ParagraphStyle('sub',fontName='Arial',fontSize=9,leading=12,textColor=muted,spaceAfter=11),
 'h':ParagraphStyle('h',fontName='Arial-Bold',fontSize=11,leading=14,textColor=blue,spaceBefore=10,spaceAfter=4),
 'p':ParagraphStyle('p',fontName='Arial',fontSize=10.5,leading=14.5,textColor=ink,spaceAfter=5),
 'small':ParagraphStyle('small',fontName='Arial',fontSize=9,leading=12.2,textColor=muted,spaceAfter=6),
}
story=[]
def p(t,style='p'):story.append(Paragraph(t,styles[style]))
def item(n,title,t):p(f'{n:02d}. {title}','h');p(t)
def box(t):
    tb=Table([[Paragraph(t,styles['p'])]],colWidths=[A4[0]-84])
    tb.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#EAF0FF')),('LEFTPADDING',(0,0),(-1,-1),11),('RIGHTPADDING',(0,0),(-1,-1),11),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
    story.append(tb)

p('Qadam Delivery: объяснение Task 5','title')
p('Короткая памятка для команды к обновлённой презентации из 12 слайдов.','sub')
box('<b>Главная мысль работы.</b> Мы предлагаем, как Qadam сможет зарабатывать: сначала 0% комиссии, позже 2-3% с курьера за выполненную доставку. Подписки нет. Окончательная цена доставки, срок бесплатного периода и детали оплаты ещё обсуждаются.')
p('<b>Что известно от команды:</b> около 100 зарегистрированных курьеров, бюджет сервера 8 300 ₸/месяц, карта сейчас бесплатная. Остальные финансовые цифры в работе - учебные предположения. Регистрации не означают, что все курьеры активны.')
p('Что говорить по слайдам','h')
item(1,'Общая идея',
 'Qadam - платформа доставки через Telegram. В Task 5 мы объясняем будущую модель заработка и проверяем её расчётами. Внедрённой комиссии пока нет.')
item(2,'Клиенты и обратная связь',
 'Сначала привлекаем частных отправителей, позже - магазины. Пользователи проверяли удобство заказа и просили добавить цену, улучшить карту, оплату картой и UI/UX. Готовность платить комиссию мы ещё не проверяли.')
item(3,'Выбор бизнес-модели',
 'Выбираем marketplace commission: платформа связывает клиента и курьера и получает процент за завершённый заказ. Доход растёт вместе с доставками. Цели «90% заявок приняты за 10 минут» и «95% принятых заказов завершены» - предложенные ориентиры для теста.')
item(4,'Как будут двигаться деньги',
 'Клиент платит напрямую курьеру. Курьер заранее пополняет баланс Qadam; после доставки платформа списывает комиссию. В примере: заказ 1 500 ₸, комиссия 2% = 30 ₸. Из баланса 1 000 ₸ остаётся 970 ₸. Само пополнение баланса ещё не является выручкой Qadam.')
item(5,'Зачем три уровня',
 'Три уровня нужны по заданию: Starter - запуск с 0%, Pro - предложение с 2%, Enterprise - будущий вариант для бизнеса до 3%. Это проект тарифной структуры без подписки. Интеграции, расширенная безопасность и SLA (обязательства по качеству сервиса) пока только предложения.')
item(6,'Как объяснить цену',
 'GMV здесь - общая стоимость выполненных доставок, без стоимости самой посылки. С каждых 1 000 ₸ комиссия 2% даёт Qadam 20 ₸. Подход «расходы + 20%» не учитывает, сколько курьер готов платить за новые заказы. Пополнение кошелька тоже создаёт неудобство и требует проверки.')

story.append(PageBreak())
p('Расчёты и ответы на вопросы','title')
p('Все примеры ниже относятся к предложенной платной модели после периода с 0%.','sub')
item(7,'Что означает 10×',
 'Условные 20% от заказа 1 500 ₸ дают комиссию 300 ₸, а 2% - 30 ₸. Поэтому 300 / 30 = 10: комиссия в примере в 10 раз меньше. <b>20% - гипотеза, не подтверждённая ставка конкурента. Экономию полной цены доставки в 10 раз мы не доказали.</b>')
item(8,'Сколько доставок покрывает сервер',
 'При 2% комиссия равна 30 ₸. Предположим прямые расходы платформы 5 ₸ на заказ: остаётся 25 ₸. Тогда 8 300 / 25 = <b>332 доставки в месяц</b> покрывают только сервер. При 3% нужно 208. С условным бюджетом привлечения 60 000 ₸ порог при 2% растёт до <b>2 732 доставок</b>. При 0% нужны средства на пилот.')
item(9,'CAC: стоимость привлечения',
 'CAC показывает, сколько стоит привлечь одного нового курьера, который начал приносить комиссию. Пример: реклама 20 000 + партнёры 5 000 + труд команды 20 000 + подключение пользователей 15 000 = 60 000 ₸. Делим на 20 новых таких курьеров: <b>CAC = 3 000 ₸</b>. В расходы включено привлечение обеих сторон платформы. Эти суммы не являются фактическими тратами.')
item(10,'LTV и срок окупаемости',
 'Предположим 20 доставок на курьера в месяц: 20 × 25 ₸ = <b>500 ₸</b> остаётся Qadam после прямых расходов, до сервера и общих затрат. Churn - доля уходящих курьеров. При условных 5% в месяц средний срок работы в модели: 1 / 0,05 = 20 месяцев. <b>LTV = 500 × 20 = 10 000 ₸</b>. Это ожидаемый вклад одного курьера за весь срок. Привлечение окупается за 3 000 / 500 = <b>6 месяцев</b>.')
item(11,'Сравнение с ориентирами инвесторов',
 'В базовом примере LTV/CAC = 10 000 / 3 000 = <b>3,33</b>: ожидаемый вклад выше стоимости привлечения. Сравниваем с ориентирами ≥3 и окупаемостью &lt;12 месяцев. При слабом спросе модель не проходит их. Если ограничить LTV первыми 36 месяцами, базовое отношение падает до <b>2,81</b>. Поэтому результат зависит от предположений и ещё требует проверки.')
item(12,'Следующие решения',
 'Определить цену доставки, срок 0%, итоговую комиссию 2% или 3%, правила баланса и возвратов. Затем измерить реальные доставки, расходы, привлечение и удержание курьеров. Оплата банковской картой остаётся пожеланием пользователей и будущей доработкой.')
p('Если преподаватель спросит, откуда взялись цифры','h')
box('«Данные о регистрациях и сервере дала команда. Для остальных параметров мы построили прозрачные учебные сценарии, потому что платную модель ещё не запускали. Они показывают условия окупаемости; теперь эти предположения нужно проверить на реальных заказах».')

def footer(c,doc):
    c.saveState();c.setStrokeColor(colors.HexColor('#D5DEEF'));c.line(42,34,A4[0]-42,34)
    c.setFillColor(muted);c.setFont('Arial',8);c.drawString(42,22,'Qadam Delivery • Task 5 • Памятка для команды');c.drawRightString(A4[0]-42,22,str(doc.page));c.restoreState()
doc=SimpleDocTemplate(str(OUT),pagesize=A4,leftMargin=42,rightMargin=42,topMargin=35,bottomMargin=45,title='Qadam Delivery - Task 5: объяснение для команды',author='Qadam Delivery Team')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
r=PdfReader(OUT);assert len(r.pages)==2,f'Expected 2 pages, got {len(r.pages)}'
alltext='\n'.join(pg.extract_text() for pg in r.pages)
for term in ['2 732','3 000','10 000','332','2,81','8 300']:assert term in alltext,term
assert '\ufffd' not in alltext
print(f'Created 2-page team guide: {OUT}')

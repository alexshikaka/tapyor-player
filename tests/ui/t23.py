import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
# 0.17: вкладка «Заказы со стрима», пометки спорных треков, авторежим, настройки «Стримерам», сайт-визитка
import asyncio, subprocess, json
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8777','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
REQS = """[
 {key:'da:1',prov:'da',name:'Emmit Braun',text:'Отличного настроения!!!! The Blasters- dark night',amount:100,currency:'RUB',at:Date.now()-60000,got:Date.now()-60000,level:'exact',state:'new',
  items:[{level:'exact',track:__T(101,'The Blasters','Dark Night',252),alts:[],flags:[],paid:true,query:'The Blasters dark night'}]},
 {key:'da:2',prov:'da',name:'Оля',text:'включи песню про кукушку',amount:100,currency:'RUB',at:Date.now()-30000,got:Date.now()-30000,level:'doubt',state:'new',
  items:[{level:'doubt',track:__T(201,'Полина Гагарина','Кукушка',260),alts:[__T(202,'Кино','Кукушка',398),__T(203,'Земфира','Кукушка',230)],flags:[],paid:true,query:'песню про кукушку'}]},
 {key:'da:3',prov:'da',name:'Петя',text:'Сборник лучшее - 2000',amount:100,currency:'RUB',at:Date.now()-20000,got:Date.now()-20000,level:'exact',state:'new',
  items:[{level:'exact',track:__T(301,'Сборник','Лучшее за 2000-е',3735),alts:[],flags:[{k:'long',t:'длинный: 1:02:15'},{k:'nonmusic',t:'не музыка?'}],paid:true}]},
 {key:'da:4',prov:'da',name:'mongol',text:'Всем по привету, шикака ку!',amount:400,currency:'RUB',at:Date.now(),got:Date.now(),level:'text',state:'new',items:[]}
]"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='mock_req.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8777/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        print('вкладка есть:', await E("!!document.querySelector('#tabs [data-tab=req]')"), '| значок скрыт:', await E("document.getElementById('reqBadge').hidden"))
        await E("JSON.parse(JSON.stringify(0));" + "(" + REQS + ").forEach(function(r){ window.__reqCb(r); })"); await pg.wait_for_timeout(300)
        print('значок:', await E("document.getElementById('reqBadge').textContent"), '| зелёный:', await E("document.getElementById('reqBadge').classList.contains('ex')"))
        await pg.click('#tabs [data-tab=req]'); await pg.wait_for_timeout(300)
        print('итог:', await E("document.getElementById('rqSum').innerText"))
        print('карточек:', await E("document.querySelectorAll('#rqList > .rq').length"), '| пометки:', await E("Array.from(document.querySelectorAll('.rq-it')).map(x=>x.className.replace('rq-it ','')+':'+x.querySelector('.rq-lv').textContent)"))
        print('кнопка всех точных:', await E("document.getElementById('rqAddAll').textContent"))
        await pg.screenshot(path='r_tab.png')
        await E("document.getElementById('rqAddAll').click()"); await pg.wait_for_timeout(400)
        print('в очереди заказ:', await E("queue.filter(v=>v.req).map(v=>v.title+' ₽'+v.req.who)"), '| строка очереди:', await E("Array.from(document.querySelectorAll('#queue .qrow .qs')).map(x=>x.textContent).filter(t=>/₽/.test(t))"))
        # под сомнением: другой вариант
        await E("document.querySelector('[data-rq=alts]').click()"); await pg.wait_for_timeout(200)
        await E("document.querySelectorAll('.rq-alt input')[1].click()"); await E("Array.from(document.querySelectorAll('[data-rq=add]')).find(b=>b.closest('.rq-it').querySelector('.rq-alt')).click()"); await pg.wait_for_timeout(400)
        print('выбран вариант:', await E("queue.filter(v=>v.req).map(v=>v.author+' — '+v.title)"), '|', [x for x in await E("window.__log") if x.startswith('remember')])
        # повтор: пробный заказ той же песни, что уже в очереди
        await E("document.getElementById('rqTest').click()"); await pg.wait_for_timeout(200)
        await pg.fill('#rqtText', 'Кино — Кукушка'); await E("document.getElementById('rqtGo').click()"); await pg.wait_for_timeout(500)
        print('пробный заказ:', await E("Array.from(document.querySelectorAll('.rq')).filter(x=>/Пробный/.test(x.textContent)).map(x=>x.querySelector('.rq-fl')?x.querySelector('.rq-fl').textContent:'без пометок')"))
        # просто текст свернут
        print('просто текст:', await E("(document.querySelector('.rq-txt summary')||{}).textContent"))
        # авторежим
        await E("RQ.auto = true; window.__reqCb({key:'da:9',prov:'da',name:'Авто',text:'Ария — Беспечный',amount:100,currency:'RUB',at:Date.now(),got:Date.now(),level:'exact',state:'new',items:[{level:'exact',track:__T(901,'Ария','Беспечный',290),alts:[],flags:[],paid:true}]})"); await pg.wait_for_timeout(400)
        print('авторежим добавил:', await E("queue.some(v=>v.req&&v.title==='Беспечный')"))
        await E("window.__reqCb({key:'da:10',prov:'da',name:'Мало',text:'Ария — Штиль',amount:50,currency:'RUB',at:Date.now(),got:Date.now(),level:'exact',state:'new',items:[{level:'exact',track:__T(902,'Ария','Штиль',290),alts:[],flags:[],paid:false}]})"); await pg.wait_for_timeout(300)
        print('не хватает суммы — не добавлен:', await E("!queue.some(v=>v.title==='Штиль')"), '| пометка:', await E("Array.from(document.querySelectorAll('.rq')).filter(x=>/Мало/.test(x.textContent)).map(x=>x.querySelector('.rq-fl').textContent)"))
        await pg.screenshot(path='r_tab2.png')
        # настройки «Стримерам»
        await pg.click('#tabs [data-tab=settings]'); await pg.wait_for_timeout(400)
        await E("document.getElementById('sStream').scrollIntoView()"); await pg.wait_for_timeout(200)
        print('сервисы:', await E("Array.from(document.querySelectorAll('#stDon .st')).map(x=>x.textContent)"), '| DA:', await E("document.querySelector('#stDon .sd').textContent"))
        await pg.fill('[data-dk=dp]', 'secretkey123'); await E("document.querySelector('[data-don=key][data-k=dp]').click()"); await pg.wait_for_timeout(300)
        print('DonatePay:', [x for x in await E("window.__log") if x.startswith('donSetKey')], await E("document.querySelectorAll('#stDon .sd')[1].textContent"))
        await pg.fill('[data-dl=da]', 'https://www.donationalerts.com/r/alexshikaka'); await pg.wait_for_timeout(600)
        print('ссылка сохранена:', await E("JSON.stringify(window.__store.donLinks)"))
        print('стоп-лист по умолчанию:', await E("document.getElementById('stStop').value.slice(0,40)"), '| макс. мин:', await E("document.getElementById('stMax').value"))
        await pg.fill('#stMax', '5'); await E("document.getElementById('stMax').dispatchEvent(new Event('change'))"); await pg.wait_for_timeout(100)
        print('правила:', await E("JSON.stringify(window.__store.reqRules)"))
        # сайт
        await pg.fill('[data-sf=nick]', 'shikaka'); await pg.wait_for_timeout(500)
        await E("document.querySelector('[data-site=preview]').click()"); await pg.wait_for_timeout(400)
        print('предпросмотр:', await E("!!document.querySelector('.site-ov iframe')"), [x for x in await E("window.__log") if x.startswith('sitePreview')])
        await E("document.querySelector('.site-ov [data-x]').click()")
        await E("document.querySelector('[data-site=tok]').click()"); await pg.wait_for_timeout(200)
        await pg.fill('#siteTok', 'ghp_test'); await E("document.querySelector('[data-site=tokset]').click()"); await pg.wait_for_timeout(300)
        await E("document.querySelector('[data-site=publish]').click()"); await pg.wait_for_timeout(400)
        print('сайт:', await E("Array.from(document.querySelectorAll('#stSite .path')).map(x=>x.textContent)"))
        await pg.screenshot(path='r_set.png', full_page=False)
        print('полосы прокрутки:', await E("getComputedStyle(document.querySelector('#rqList'),'::-webkit-scrollbar').width"))
        print('ошибки:', errs)
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()

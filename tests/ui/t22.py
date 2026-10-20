import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
# Правки 0.16.1: шапка (вход, обновления), пилюли плейлистов (цвет, меню, обложка), очередь (повторы, перелёт, «Дальше…»), «Волна по треку»
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8777','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(script="(function(){var s=window.__store;s.savedLists=[{src:'tap',type:'tap',listId:'tp1',title:'Рок на стрим',author:'Тапёр',tracks:[{src:'ym',id:'91',albumId:'9',title:'Песня А',author:'X',duration:'0:40',seconds:40,thumb:''},{src:'ym',id:'92',albumId:'9',title:'Песня Б',author:'Y',duration:'0:40',seconds:40,thumb:''}]},{src:'tap',type:'tap',listId:'tp2',title:'Чил',author:'Тапёр',tracks:[]}];})();")
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8777/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        # шапка: круглые кнопки входа, раскрытие при наведении
        w0 = await E("document.getElementById('acct').getBoundingClientRect().width")
        await pg.hover('#acct'); await pg.wait_for_timeout(400)
        w1 = await E("document.getElementById('acct').getBoundingClientRect().width")
        print('вход Яндекс: круг', round(w0), '→ при наведении', round(w1), '|', await E("document.getElementById('acct').textContent"))
        print('кнопка обновлений: текста нет:', await E("document.getElementById('updCheck').textContent.trim()===''"), '| подсказка:', await E("document.getElementById('updCheck').dataset.tip"))
        await pg.screenshot(path='h_head2.png', clip={'x':900,'y':30,'width':540,'height':50})
        # «Волна по треку» слева от кнопок, с текстом
        await pg.fill('#search','рок'); await pg.press('#search','Enter'); await pg.wait_for_timeout(700)
        await E("document.querySelector('#results .row').click()"); await pg.wait_for_timeout(700)
        print('волна по треку:', await E("(function(){var w=document.getElementById('waveTrackBtn').getBoundingClientRect(),p=document.getElementById('prev').getBoundingClientRect();return [!document.getElementById('waveTrackBtn').hidden, w.right<=p.left, document.getElementById('waveTrackBtn').textContent.trim()];})()"))
        # очередь: повторы в сыгранном и перелёт
        await E("addMany([{src:'ym',id:'501',albumId:'9',title:'Раз',author:'A',duration:'0:40',seconds:40,thumb:''},{src:'ym',id:'502',albumId:'9',title:'Два',author:'B',duration:'0:40',seconds:40,thumb:''},{src:'ym',id:'503',albumId:'9',title:'Три',author:'C',duration:'0:40',seconds:40,thumb:''}])"); await pg.wait_for_timeout(300)
        n0 = await E("queue.length")
        await E("playQueueItem(queue.findIndex(function(v){return v.id==='503'}))"); await pg.wait_for_timeout(60)
        tr = await E("(function(){var r=Array.from(document.querySelectorAll('#queue .qrow')).find(function(x){return x._q&&x._q.id==='503'});return r?r.style.transform||getComputedStyle(r).transform:'нет'})()")
        print('перелёт (в начале анимации):', tr)
        await pg.wait_for_timeout(500)
        await E("playQueueItem(queue.findIndex(function(v){return v.id==='501'}))"); await pg.wait_for_timeout(500)
        await E("playQueueItem(queue.findIndex(function(v){return v.id==='503'}))"); await pg.wait_for_timeout(500)
        print('сыграно «Три» дважды — в ленте строк «Три»:', await E("queue.filter(function(v){return v.id==='503'}).length"))
        # плейлисты: иконки-кнопки, цвет пилюль, меню, обложка
        await pg.click('#tabs [data-tab=my]'); await pg.wait_for_timeout(700)
        print('кнопки справа:', await E("Array.from(document.querySelectorAll('#mySide .myact .myab')).map(x=>x.dataset.tip+'|'+x.textContent.trim())"))
        await pg.hover('#mySide [data-import]'); await pg.wait_for_timeout(200)
        print('подсказка:', await E("getComputedStyle(document.querySelector('#mySide [data-import]'),'::after').content"))
        print('пилюли с цветом:', await E("Array.from(document.querySelectorAll('#mySide .mypills .mit')).map(x=>x.textContent.trim().slice(0,12)+':'+(x.style.getPropertyValue('--tint')||'-'))"))
        await E("var b=Array.from(document.querySelectorAll('#mySide .mit')).find(x=>/Чил/.test(x.textContent)); b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:200}))"); await pg.wait_for_timeout(200)
        print('меню плейлиста:', await E("Array.from(document.querySelectorAll('.ctx button')).map(x=>x.textContent)"))
        await pg.screenshot(path='p_menu.png')
        await E("Array.from(document.querySelectorAll('.ctx button')).find(x=>/обложку/.test(x.textContent)).click()"); await pg.wait_for_timeout(400)
        print('вариантов обложки:', await E("document.querySelectorAll('.cov-o').length"))
        await pg.screenshot(path='p_cover.png')
        await E("document.querySelectorAll('.cov-o[data-k]')[1].click()"); await pg.wait_for_timeout(400)
        print('обложка сохранена:', await E("JSON.stringify(window.__store.plCovers)"), '| пилюля:', await E("(function(){var b=Array.from(document.querySelectorAll('#mySide .mit')).find(x=>/Чил/.test(x.textContent));return b.style.getPropertyValue('--tint')})()"))
        print('обложка плейлиста сверху:', await E("getComputedStyle(document.querySelector('#myPl .plhead')).alignItems"))
        await E("Array.from(document.querySelectorAll('#mySide .mit')).find(x=>/Рок на стрим/.test(x.textContent)).click()"); await pg.wait_for_timeout(400)
        print('«Всё в очередь» цветом «В очередь»:', await E("getComputedStyle(document.querySelector('#myPl [data-a=queue]')).backgroundColor===getComputedStyle(document.querySelector('#myPl .add')).backgroundColor"))
        # «Дальше в плейлисте — играет фоном …»
        await E("document.querySelector('#myPl [data-a=shuffle]').click()"); await pg.wait_for_timeout(800)
        print('строка «Дальше»:', await E("(document.querySelector('.qn-h')||{}).textContent"), '| вес шрифта:', await E("document.querySelector('.qn-t')?getComputedStyle(document.querySelector('.qn-t')).fontWeight:'-'"))
        await pg.screenshot(path='p_pl.png')
        print('ошибки:', errs)
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()

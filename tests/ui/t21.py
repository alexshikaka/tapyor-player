import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
# Громкость рядом с кнопками и колёсико; фон-плейлист ↔ волна в карточке волны; плейлисты фоном из меню волны
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8777','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(script="window.__store_init=1;(function(){var s=window.__store;s.savedLists=[{src:'tap',type:'tap',listId:'tp1',title:'Рок на стрим',author:'Тапёр',tracks:[{src:'ym',id:'91',albumId:'9',title:'Песня А',author:'X',duration:'0:40',seconds:40,thumb:''},{src:'ym',id:'92',albumId:'9',title:'Песня Б',author:'Y',duration:'0:40',seconds:40,thumb:''}]}];})();")
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8777/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        # громкость рядом с кнопками
        r = await E("(function(){var n=document.getElementById('next').getBoundingClientRect(), v=document.getElementById('vol').getBoundingClientRect(); return [Math.round(v.left-n.right), Math.round(Math.abs((v.top+v.bottom)/2-(n.top+n.bottom)/2))];})()")
        print('громкость: от кнопки «вперёд»', r[0], 'px, по вертикали ±', r[1])
        v0 = await E("parseFloat(document.getElementById('vol').value)")
        box = await E("(function(){var r=document.getElementById('vol').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()")
        await pg.mouse.move(box[0], box[1]); await pg.mouse.wheel(0, -100); await pg.wait_for_timeout(60)
        mid = await E("parseFloat(document.getElementById('vol').value)")
        await pg.wait_for_timeout(600)
        v1 = await E("parseFloat(document.getElementById('vol').value)")
        print('колёсико вверх: %.1f → (через 60 мс %.2f) → %.1f' % (v0, mid, v1), '| подпись:', await E("document.getElementById('volVal').textContent"))
        await pg.mouse.wheel(0, 300); await pg.wait_for_timeout(700)
        print('три щелчка вниз:', round(await E("parseFloat(document.getElementById('vol').value)"),1))
        await E("document.getElementById('muteBtn').click()"); await pg.wait_for_timeout(700)
        print('без звука:', round(await E("parseFloat(document.getElementById('vol').value)"),1))
        await E("document.getElementById('muteBtn').click()"); await pg.wait_for_timeout(700)
        print('звук вернулся:', round(await E("parseFloat(document.getElementById('vol').value)"),1))
        # меню волны: плейлисты фоном
        await E("document.getElementById('waveGear').click()"); await pg.wait_for_timeout(500)
        pls = await E("Array.from(document.querySelectorAll('#wavePls .wv')).map(x=>x.textContent)")
        print('плейлисты в меню волны:', pls)
        await E("Array.from(document.querySelectorAll('#wavePls .wv')).find(x=>/Рок на стрим/.test(x.textContent)).click()"); await pg.wait_for_timeout(900)
        print('после выбора плейлиста:', await E("document.getElementById('waveTitle').textContent"), '|', await E("document.getElementById('waveSub').textContent"), '| встряхнуть:', await E("document.getElementById('waveShakeT').textContent"))
        print('играет:', await E("document.getElementById('nplabel').textContent"))
        # смена настроения → снова волна
        await E("document.getElementById('waveGear').click()"); await pg.wait_for_timeout(200)
        if await E("document.getElementById('waveSettings').hidden"): await E("document.getElementById('waveGear').click()")
        await E("document.querySelector('#waveMood .wchip[data-v=calm]').click()"); await pg.wait_for_timeout(900)
        print('после «Спокойное»:', await E("document.getElementById('waveTitle').textContent"), '|', await E("document.getElementById('waveSub').textContent"), '| встряхнуть:', await E("document.getElementById('waveShakeT').textContent"))
        print('журнал волны:', [x for x in await E("window.__log") if x.startswith('waveStart')][-1:])
        print('ошибки:', errs)
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()

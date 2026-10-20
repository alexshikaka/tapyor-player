import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8780','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8780/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        await E("A.suggest=function(t){return new Promise(function(r){setTimeout(function(){r({source:'ym',items:[t+' 1',t+' 2']})},400)})}")
        await pg.click('#search'); await pg.type('#search','Кино'); await pg.wait_for_timeout(150); await pg.press('#search','Enter'); await pg.wait_for_timeout(900)
        print('подсказки после Enter скрыты:', await E("getComputedStyle($('suggest')).display==='none'"))
        await pg.fill('#search','Рок'); await pg.press('#search','Enter'); await pg.wait_for_timeout(600)
        print('новый поиск руками — кнопки «Назад» нет:', await E("!document.querySelector('.sback')"))
        await E("openTrackMenu(300,300,S.tracks[0])"); await pg.click('.ctx button:has-text(\"Искать\")'); await pg.wait_for_timeout(600)
        print('из меню «Искать» — «Назад» есть:', await E("(document.querySelector('.sback')||{}).textContent"))
        await pg.click('#results .tarea .row .al >> nth=0'); await pg.wait_for_timeout(600)
        print('страница исполнителя, имя в строке поиска:', await E("search.value"))
        await pg.click('.plbtns [data-ap=search]'); await pg.wait_for_timeout(900)
        print('вкладка «Поиск» на странице:', await E("(document.querySelector('.ar-tabs .on')||{}).textContent"), '| шапка на месте:', await E("!!document.querySelector('#searchPl .arh h3')"), '| строк:', await E("document.querySelectorAll('.ar-body .row').length"))
        await pg.screenshot(path='b_search.png')
        print('ошибки:', errs)
        await b.close()
asyncio.run(main()); srv.terminate()

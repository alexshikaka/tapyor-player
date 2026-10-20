import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess, json
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8777','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('con:'+m.text) if m.type=='error' else None)
        await pg.goto('http://127.0.0.1:8777/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        await pg.fill('#search','Кино Группа крови'); await pg.press('#search','Enter'); await pg.wait_for_timeout(900)
        rows = await E("Array.from(document.querySelectorAll('#results .tarea .row')).map(r=>r.dataset.src+':'+r.querySelector('.t').textContent+' ['+(r.querySelector('.rbs')?r.querySelector('.rbs').textContent:'')+']')")
        print('УМНЫЙ:', *rows, sep='\n  ')
        await pg.screenshot(path='s_smart.png')
        for m in ['exact','free','air','src']:
            await E(f"setSearchMode('{m}')"); await pg.wait_for_timeout(150)
            rows = await E("Array.from(document.querySelectorAll('#results .tarea .row')).filter(r=>r.offsetParent).map(r=>r.dataset.src+':'+r.querySelector('.t').textContent)")
            print(m.upper()+':', ' | '.join(rows))
        await pg.screenshot(path='s_src.png')
        await E("setSearchMode('smart')"); await pg.wait_for_timeout(100)
        # меню выдачи
        await pg.click('#smode'); await pg.wait_for_timeout(150); await pg.screenshot(path='s_menu.png')
        print('меню выдачи пунктов:', await E("document.querySelectorAll('.ctx button').length"))
        await pg.keyboard.press('Escape')
        # версии
        await pg.click('#results .tarea .row .vers'); await pg.wait_for_timeout(150)
        print('версии:', await E("Array.from(document.querySelectorAll('.ctx button')).map(b=>b.textContent)"))
        await pg.keyboard.press('Escape')
        # клик по артисту в строке (не должен запускать трек)
        await E("window.__played=null; var _pn=playNow; playNow=function(v){window.__played=v?v.id:'null'; return v?_pn(v):undefined;}")
        await pg.click('#results .tarea .row .al >> nth=0'); await pg.wait_for_timeout(600)
        print('клик по артисту → страница исполнителя:', await E("(document.querySelector('#searchPl .arh h3')||{}).textContent"), '| playNow:', await E("String(window.__played)"))
        print('вкладки страницы:', await E("Array.from(document.querySelectorAll('.ar-tabs button')).map(b=>b.innerText.replace(/\\s+/g,' '))"))
        await pg.click('.ar-tabs [data-apt=all]'); await pg.wait_for_timeout(400)
        print('все треки на странице:', await E("document.querySelectorAll('.ar-body .row').length"))
        await pg.click('#searchPl [data-back]'); await pg.wait_for_timeout(300)
        # несколько артистов
        print('Би-2, Кино → ссылки:', await E("Array.from(document.querySelectorAll('.row')).map(r=>Array.from(r.querySelectorAll('.al')).map(a=>a.dataset.artist).join('+')).filter(x=>x.includes('+'))[0]"))
        # Плейлисты: создать через меню трека
        await E("openTrackMenu(300,300,S.tracks[0])"); await pg.wait_for_timeout(100)
        await pg.click('.ctx button:has-text(\"В плейлист\")'); await pg.wait_for_timeout(100)
        await pg.click('.ctx button:has-text(\"Новый плейлист\")'); await pg.wait_for_timeout(100)
        await pg.screenshot(path='s_ask.png')
        await pg.fill('.ask input[type=text]','Рок на стрим'); await pg.press('.ask input[type=text]','Enter'); await pg.wait_for_timeout(200)
        print('мои плейлисты:', await E("localLists().map(m=>m.title+':'+m.tracks.length)"), '| toast:', await E("$('toast').textContent"))
        await E("var m=localLists()[0]; localAdd(m,[S.tracks[1],S.tracks[0],S.tracks[2]])")
        print('после добавления:', await E("localLists()[0].tracks.length"))
        # второй плейлист и объединение
        await E("var m2=localCreate('Второй',[S.tracks[0],S.tracks[3]]);")
        await E("setTab('my')"); await pg.wait_for_timeout(400)
        await pg.click('#mySide [data-merge]'); await pg.wait_for_timeout(100)
        for t in ['Рок на стрим','Второй']:
            await pg.click(f'#mySide .mit:has-text("{t}")')
        await pg.screenshot(path='s_merge.png')
        await pg.click('#mySide [data-mgo]'); await pg.wait_for_timeout(200)
        await pg.screenshot(path='s_merge2.png')
        await pg.click('.ask [data-x="1"]'); await pg.wait_for_timeout(500)
        print('после объединения:', await E("localLists().map(m=>m.title+':'+m.tracks.length)"), '|', await E("$('toast').textContent"))
        await pg.screenshot(path='s_pl.png')
        # переименовать
        await E("localRename(localLists()[0])"); await pg.wait_for_timeout(100)
        await pg.fill('.ask input[type=text]','Сборник'); await pg.click('.ask [data-x="1"]'); await pg.wait_for_timeout(200)
        print('переименован:', await E("localLists()[0].title"), '| заголовок:', await E("document.querySelector('#myPl h3').textContent"))
        # убрать трек и вернуть
        await pg.click('#myPl .prow .more >> nth=0'); await pg.wait_for_timeout(150)
        await pg.click('.ctx button:has-text("Убрать из плейлиста")'); await pg.wait_for_timeout(150)
        n1 = await E("localLists()[0].tracks.length"); await pg.click('#toast button'); await pg.wait_for_timeout(150)
        print('убрать/вернуть:', n1, '→', await E("localLists()[0].tracks.length"))
        # удалить и вернуть
        await pg.click('#myPl [data-a="del"]'); await pg.wait_for_timeout(150)
        n2 = await E("localLists().length"); await pg.click('#toast button'); await pg.wait_for_timeout(150)
        print('удалить/вернуть:', n2, '→', await E("localLists().length"))
        # сохранено в настройках
        print('savedLists сохранён:', await E("JSON.stringify(window.__log.filter(x=>x.startsWith('set savedLists')).slice(-1)).length>20"))
        # настройки поиска
        await E("setTab('settings')"); await pg.wait_for_timeout(300)
        await E("$('sSearch').scrollIntoView()"); await pg.wait_for_timeout(200)
        await pg.click('#setSrcOrder button[data-dn="0"]'); await pg.wait_for_timeout(100)
        print('порядок:', await E("srcOrder.join()"))
        await pg.screenshot(path='s_set.png')
        # нижний плеер: ссылка на артиста
        await E("setTab('search')"); await E("playNow(S.tracks[0])"); await pg.wait_for_timeout(800)
        print('card-sub ссылки:', await E("document.querySelectorAll('#card-sub .al, #f-sub .al').length"))
        print('ошибки:', errs)
        await b.close()
asyncio.run(main()); srv.terminate()

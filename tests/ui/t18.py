import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8783','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':1000}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8783/app2/index.html'); await pg.wait_for_timeout(1000)
        E=pg.evaluate
        await pg.screenshot(path='q_run.png')
        await pg.wait_for_timeout(1200)
        print('первый запуск — список открыт:', await E("!!document.querySelector('#qcBox .ck')"), '| заголовок:', await E("document.querySelector('#qcBox .ck-h b').textContent"))
        await pg.screenshot(path='q_ok.png')
        # второй запуск — всё хорошо → свёрнуто
        await pg.reload(); await pg.wait_for_timeout(4000)
        print('второй запуск — свёрнуто:', await E("(document.querySelector('#qcMini')||{}).textContent"))
        # проблемы
        await E("window.__qcItems={net:{state:'ok',text:'есть'},app:{state:'warn',text:'вышла 0.14.1',action:'update'},recipes:{state:'ok',text:'v7'},'ym.svc':{state:'ok',text:'доступен'},'ym.acc':{state:'bad',text:'вход устарел',action:'ym-login'},'ym.play':{state:'off',text:'нужен вход'},'ym.site':{state:'bad',text:'сайт изменился',action:'fix'},'yt.svc':{state:'bad',text:'не отвечает',action:'vpn'},'yt.login':{state:'off',text:'нет входа',action:'yt-login'},'yt.dlp':{state:'ok',text:'свежий'},sc:{state:'ok',text:'доступны'},refs:{state:'warn',text:'Last.fm без ключа'},tg:{state:'ok',text:'ok'}}; runQC()")
        await pg.wait_for_timeout(1500)
        print('проблемы:', await E("document.querySelector('#qcBox .ck-h b').textContent"), '| ⚠:', await E("$('healthWarn').hidden ? 'нет' : $('healthWarn').textContent"))
        await pg.screenshot(path='q_bad.png')
        await pg.click('#qcBox [data-qa=vpn]'); await pg.wait_for_timeout(100)
        await pg.click('#qcFix'); await pg.wait_for_timeout(500)
        print('после починки:', await E("document.querySelector('#qcBox .ck-note').innerText.slice(0,120)"))
        await pg.fill('#search','Кино'); await pg.press('#search','Enter'); await pg.wait_for_timeout(600)
        print('после поиска список убран:', await E("!document.querySelector('#qcBox')"))
        await E("setTab('settings'); $('sHealth').scrollIntoView()"); await pg.click('#repTest'); await pg.wait_for_timeout(200)
        print('отчёт:', await E("$('repNote').textContent"))
        print('ошибки:', errs)
        await b.close()
asyncio.run(main()); srv.terminate()

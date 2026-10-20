import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8778','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8778/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        await E("var _o=A.ytLoginPaste; A.ytLoginPaste=function(t){return _o(t).then(function(r){r.pasted={kind:/curl/.test(t)?'curl':'text',len:(t||'').length};return r;});}")
        await pg.screenshot(path='h_head.png', clip={'x':0,'y':0,'width':1440,'height':130})
        await pg.fill('#search','Кино'); await pg.press('#search','Enter'); await pg.wait_for_timeout(700)
        await pg.click('.art-n'); await pg.wait_for_timeout(500)
        print('клик по имени → открыт список:', await E("!$('searchPl').hidden"), '|', await E("(document.querySelector('#searchPl h3')||{}).textContent"))
        await E("openYtDlg()"); await pg.wait_for_timeout(300)
        await E("ytPaste(\"curl 'https://www.youtube.com/' -H 'cookie: SAPISID=1; x=2'\")"); await pg.wait_for_timeout(500)
        print('итог вставки:', await E("(document.querySelector('#ytDlg .yl-pres')||{}).innerText"))
        await pg.screenshot(path='h_paste.png')
        await E("ytPaste('hello')"); await pg.wait_for_timeout(500)
        print('ошибка вставки:', await E("(document.querySelector('#ytDlg .yl-pres')||{}).innerText"))
        await E("document.querySelector('#ytDlg').scrollTop=0"); await pg.click('#ytDlgClose svg', force=True); await pg.wait_for_timeout(200)
        print('крестик закрыл:', await E("$('ytDlg').hidden"))
        print('ошибки:', errs)
        await b.close()
asyncio.run(main()); srv.terminate()

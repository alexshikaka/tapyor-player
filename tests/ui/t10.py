import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8775','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8775/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        await E("playNow({src:'ym', id:'L1', albumId:'1', title:'Трек', author:'A', duration:'0:33', thumb:''})"); await pg.wait_for_timeout(1000)
        await E("setTab('settings')"); await E("__log.length=0")
        await pg.click('#hsRun'); await pg.wait_for_timeout(300)
        print('играет → запусков:', await E("__log.filter(function(x){return x=='healthRun'}).length"))
        await E("master().pause()"); await pg.wait_for_timeout(300)
        await pg.click('#hsRun'); await pg.wait_for_timeout(800)
        print('на паузе → запусков:', await E("__log.filter(function(x){return x=='healthRun'}).length"), '| значок:', await E("$('healthWarn').textContent"))
        print('ошибки:', errs)
        await b.close()
    srv.kill()
asyncio.run(main())

import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8782','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8782/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        await E("setTab('settings')"); await E("$('sLook').scrollIntoView()"); await pg.wait_for_timeout(200)
        await pg.click('#teList [data-th=mono]'); await pg.wait_for_timeout(200)
        print('тема:', await E("document.documentElement.className"), '| сохранено:', await E("window.__log.filter(x=>x.startsWith('set theme')).pop()"))
        await pg.screenshot(path='m_set.png')
        await E("setTab('search')"); await pg.fill('#search','Кино'); await pg.press('#search','Enter'); await pg.wait_for_timeout(700)
        await pg.screenshot(path='m_search.png')
        await E("openArtistPage('Кино','77')"); await pg.wait_for_timeout(700); await pg.screenshot(path='m_artist.png')
        await pg.reload(); await pg.wait_for_timeout(600)
        print('после перезапуска:', await E("document.documentElement.className"))
        print('ошибки:', errs)
        await b.close()
asyncio.run(main()); srv.terminate()

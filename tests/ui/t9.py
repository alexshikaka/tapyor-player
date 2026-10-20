import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8774','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock7.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8774/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        await E("setTab('search'); search.value='рок'; doSearch()"); await pg.wait_for_timeout(1000)
        print('строк SoundCloud:', await E("document.querySelectorAll('#results .row[data-src=sc]').length"), '| подпись источника:', await E("document.querySelector('#results .row[data-src=sc] .ss').textContent"))
        await pg.click('#chips [data-f=sc]'); await pg.wait_for_timeout(200)
        print('фильтр SoundCloud — видно строк Яндекса:', await E("Array.prototype.filter.call(document.querySelectorAll('#results .row[data-src=ym]'), function(r){ return r.offsetParent }).length"), ', SoundCloud:', await E("Array.prototype.filter.call(document.querySelectorAll('#results .row[data-src=sc]'), function(r){ return r.offsetParent }).length"))
        await pg.screenshot(path='sc.png')
        await pg.click('#results .row[data-src=sc]'); await pg.wait_for_timeout(2500)
        print('играет:', await E("queue[current].title"), '| режим', await E("mode"), '| hls:', await E("!!aud._hls"), '| время', await E("aud.currentTime.toFixed(1)"), '| пауза?', await E("aud.paused"))
        await E("playNow({ src: 'sc', id: 'https://soundcloud.com/a/bad', title: 'Битый', author: 'DJ B', duration: '0:33', seconds: 33, thumb: '' })"); await pg.wait_for_timeout(2500)
        print('битый → замена:', await E("queue[current].title + ' / ' + srcName(queue[current])"), '|', [l for l in await E("__log") if 'HLS' in l or 'findAlt' in l][:3])
        print('Audius строк:', await E("document.querySelectorAll('#results .row[data-src=au]').length"))
        await E("setTab('search'); search.value='рок'; doSearch()"); await pg.wait_for_timeout(1000)
        await pg.click('#chips [data-f=all]'); await pg.wait_for_timeout(200)
        await pg.click('#results .row[data-src=au]'); await pg.wait_for_timeout(1200)
        print('Audius играет:', await E("queue[current].title + ' / ' + srcName(queue[current]) + ' / пауза? ' + aud.paused"))
        await pg.screenshot(path='sc_au.png')
        print('ошибки:', errs)
        await b.close()
    srv.kill()
asyncio.run(main())

import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8776','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('con:'+m.text) if m.type=='error' else None)
        await pg.goto('http://127.0.0.1:8776/app2/index.html'); await pg.wait_for_timeout(700)
        E=pg.evaluate
        print('граф НЕ строится:', await E("axInit()===false && AX.ctx===null"))
        # Яндекс громкий трек (lufs -8) → приглушение, но играет
        await E("playNow({src:'ym', id:'L1', albumId:'1', title:'Громкий', author:'A', duration:'0:33', seconds:33, lufs:-8, thumb:''})"); await pg.wait_for_timeout(1500)
        print('играет:', await E("!aud.paused"), '| crossOrigin НЕ стоит:', await E("!aud.crossOrigin"), '| _norm:', await E("aud._norm && aud._norm.toFixed(2)"), '| volume:', await E("aud.volume.toFixed(2)"))
        # Выключить ровную громкость → норм 1
        await E("setNormalize(false)"); await pg.wait_for_timeout(200)
        print('после выкл: _norm', await E("aud._norm"), '| volume', await E("aud.volume.toFixed(2)"))
        # Тихий трек при включённой: норм>1 но volume<=1, играет
        await E("setNormalize(true); playNow({src:'ym', id:'L2', albumId:'1', title:'Тихий', author:'A', duration:'0:33', seconds:33, lufs:-22, thumb:''})"); await pg.wait_for_timeout(1200)
        print('тихий играет:', await E("!aud.paused"), '| volume', await E("aud.volume.toFixed(2)"))
        # Кроссфейд ещё работает
        await E("AX.xfade=3; addToQueue({src:'ym', id:'L3', albumId:'1', title:'Следующий', author:'B', duration:'0:33', seconds:33, lufs:-10, thumb:''})")
        await pg.wait_for_timeout(500); d=await E("aud.duration")
        await E("aud.currentTime = aud.duration - 1.2"); await pg.wait_for_timeout(1800)
        print('переход: играет', await E("queue[current].title"), '| пауза?', await E("master().paused"))
        print('ошибки:', [e for e in errs if 'favicon' not in e][:5])
        await b.close()
    srv.kill()
asyncio.run(main())

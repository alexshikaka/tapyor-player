import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8784','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':1300}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8784/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate
        await E("setTab('settings'); $('sLook').scrollIntoView()"); await pg.wait_for_timeout(200)
        print('темы:', await E("Array.from(document.querySelectorAll('#teList .te-c b')).map(x=>x.textContent)"))
        await pg.click('#teList [data-th-new]'); await pg.wait_for_timeout(300)
        print('создана, класс:', await E("document.documentElement.className"), '| --bg1:', await E("getComputedStyle(document.documentElement).getPropertyValue('--bg1')"))
        await pg.fill('#teHex_accent', '#E5484D'); await pg.wait_for_timeout(500)
        print('акцент:', await E("getComputedStyle(document.documentElement).getPropertyValue('--ac')"))
        await pg.click('#teTones [data-tone=red]'); await pg.click('#tePick'); await pg.wait_for_timeout(800)
        print('вариантов:', await E("document.querySelectorAll('#teVars .tvar').length"), await E("Array.from(document.querySelectorAll('#teVars small')).map(x=>x.textContent).join(',')"))
        await pg.screenshot(path='e_editor.png')
        await pg.click('#teVars [data-var=\"1\"]'); await pg.wait_for_timeout(400)
        print('после варианта --bg1:', await E("getComputedStyle(document.documentElement).getPropertyValue('--bg1')"))
        await pg.click('#teMode [data-v=light]'); await pg.wait_for_timeout(400)
        print('светлая:', await E("document.documentElement.classList.contains('theme-light')"), await E("getComputedStyle(document.documentElement).getPropertyValue('--bg1')"))
        await pg.screenshot(path='e_light.png')
        code = await E("document.querySelector('#teEd .te-code').textContent"); print('код:', code)
        await pg.click('#teList [data-th-import]'); await pg.wait_for_timeout(100)
        await pg.fill('.ask input[type=text]', code); await pg.click('.ask [data-x=\"1\"]'); await pg.wait_for_timeout(400)
        print('после импорта тем:', await E("myThemes.length"))
        await pg.click('#teDel'); await pg.wait_for_timeout(200)
        print('после удаления:', await E("myThemes.length"), await E("curThemeId"))
        await pg.click('#toast button'); await pg.wait_for_timeout(200)
        print('вернул:', await E("myThemes.length"), await E("curThemeId"))
        print('сохранено themes:', await E("window.__log.filter(x=>x.startsWith('set themes')).length>0"), '| themeBar:', await E("(window.__log.filter(x=>x.startsWith('set themeBar')).pop()||'').slice(0,60)"))
        await pg.click('#teList [data-th=violet]'); await pg.wait_for_timeout(200)
        print('назад на фиолетовую:', await E("document.documentElement.className"), '|', await E("getComputedStyle(document.documentElement).getPropertyValue('--bg1').trim()"))
        await E("setTab('search')"); await E("localStorage.setItem('tapTheme','c:x'); localStorage.setItem('tapThemeVars', JSON.stringify({_light:true,bg1:'#F4F4F6',tx:'#111'}))")
        await pg.reload(); await pg.wait_for_timeout(100)

        print('ошибки:', errs)
        await b.close()
asyncio.run(main()); srv.terminate()

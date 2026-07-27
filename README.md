# Neptun PowerUp!

[![CI](https://github.com/surilevi/neptun-powerup-userscript/actions/workflows/ci.yml/badge.svg)](https://github.com/surilevi/neptun-powerup-userscript/actions/workflows/ci.yml)
[![CodeQL](https://github.com/surilevi/neptun-powerup-userscript/actions/workflows/codeql.yml/badge.svg)](https://github.com/surilevi/neptun-powerup-userscript/actions/workflows/codeql.yml)
[![Version](https://img.shields.io/github/package-json/v/surilevi/neptun-powerup-userscript?label=version)](https://github.com/surilevi/neptun-powerup-userscript/raw/main/dist/npu.user.js)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178c6.svg)](https://www.typescriptlang.org/)

Magyar nyelvű Tampermonkey userscript Neptunhoz. A célja egyszerű: kevesebb ismétlődő kattintás, kevesebb kapkodás tárgyfelvételkor és vizsgajelentkezéskor.

A script nem helyetted dönt, és nem kerül meg Neptun-szabályokat. A már kiválasztott kurzusokat és vizsgaidőpontokat tudja elmenteni, visszatölteni, majd kérésre végigkattintani. Emellett normál használat közben próbálja életben tartani az aktív munkamenetet, de nagy terhelésű tárgyfelvételi vagy vizsgajelentkezési időszakban ezt nem lehet garantálni.

> Fontos: ez a projekt böngészőben futó automatizálást végez a Neptun felületén. Csak saját felelősségre használd, és vedd figyelembe a saját intézményed szabályait.

## Mire jó?

- `Course Store`: elsődlegesen a Neptun `Órarendtervező` részében már kiválasztott pontos kurzusokkal dolgozik. A helyi mentés és visszatöltés továbbra is megmarad tartalékként.
- `Safe Preview`: az órarendtervezőben vagy helyben mentett kurzustalálatokat és a kapcsolódó felvételi gombokat kiemeli anélkül, hogy kurzust választana vagy tárgyat venne fel.
- `Course Rush`: az órarendtervező pontos kurzusválasztásait olvassa ki, majd a látható `Tárgy felvétele` gombokat egymás után kattintja. Belépés után magától megnyitja a `Tárgyfelvétel` oldalt, egyszer lefut, majd kikapcsolja önmagát. Üres tervezőnél a helyben mentett választás lehet a tartalék.
- `Exam Planner`: naptárban mutatja a látható felvett és mentett vizsgaidőpontokat, és továbbra is el tud menteni egy választott időpontot későbbi jelentkezéshez.
- `Exam Rush`: az aktuálisan látható vizsgaoldalon végigpróbálja a mentett vizsgacélokat.
- `Infinite Session`: normál használat közben megpróbálja frissen tartani a munkamenetet. Tárgyfelvételi vagy vizsgajelentkezési roham alatt a Neptun ettől függetlenül is kidobhat.
- `Theme`: választható színkiemelés a Neptun felületén.

## Course Rush előkészítése

1. A `Tárgyfelvétel` oldalon add hozzá az összes kívánt pontos kurzust a Neptun `Órarendtervező` részéhez.
2. Az NPU panelen nyomd meg a `Preview Planner` gombot. A Safe Preview megnyithatja az órarendtervezőt, `Lista nézet`-re válthat és lenyithatja a tárgyfejléceket, de nem módosít kurzusjelölőt, tervezőállapotot vagy felvételt.
3. Ellenőrizd a kiemelt tárgykódokat, kurzuskódokat és `Tárgy felvétele` gombokat.
4. Kapcsold ki a Neptun saját tárgyfelvételi megerősítő felugró ablakát. Ezt egy olyan tárgynál tedd meg, amelyet egyébként is felvennél: a Neptun megerősítésében válaszd a „ne jelenjen meg újra” lehetőséget, majd a saját döntésed szerint fejezd be vagy szakítsd meg azt a kézi műveletet.
5. Az azonnali futtatáshoz használd az `Enroll Planner` gombot, belépés utáni futtatáshoz pedig kapcsold be a `Course Rush` kapcsolót. A kapcsolót akár kijelentkezett állapotban is bekapcsolhatod: belépés után az NPU magától megnyitja a `Tárgyfelvétel` oldalt.

Az `Enroll Planner` külön NPU-megerősítés nélkül, azonnal indul; a gomb megnyomása a látható, órarendtervezőben előkészített célok felvételének jóváhagyását jelenti. A `Course Rush` belépés után ugyanígy indul, majd azonnal kikapcsolja önmagát. Mindkét út újra ellenőrzi az egyes pontos kurzusválasztásokat, és ugyanazokat a Neptun felületi `Tárgy felvétele` gombokat használja egymás után; az NPU nem küld közvetlen, rejtett felvételi API-kérést. Egy tárgy hibája után a következő még érvényes tervezőcélokkal folytatja.

Ha a Neptun saját megerősítő ablaka mégis megjelenik, az NPU az első érintett tárgynál megáll, és a többi felvételi gombot nem kattintja meg. A helyi `Save Local`, `Preview Saved` és `Local Load + Enroll` műveletek azoknak maradnak meg tartalékként, akik nem az órarendtervezős folyamatot használják.

### Hibakezelés felvétel közben

A Neptun a felvétel eredményét nem a HTTP állapotkódban adja vissza: elutasításkor is 500-as választ küld, a tényleges okot pedig az értesítés szövege tartalmazza. Az NPU ezért az értesítést nézi, nem az állapotkódot.

- Ha a Neptun egyértelműen elutasítja a tárgyat (például betelt a kurzus létszáma), az NPU nem próbálkozik újra ugyanazzal a tárggyal, hanem továbblép a következőre.
- Ha a Neptun azt válaszolja, hogy jelenleg nincs tárgyjelentkezési időszak, a futás azonnal leáll. Ez a válasz minden tárgyra egyformán vonatkozik, így nincs értelme a többi felvételi gombot is végigkattintani.
- Újrapróbálkozás csak akkor történik, ha a válasz tényleg átmeneti hibára utal (túlterhelt vagy nem válaszoló szerver), és ilyenkor is korlátozott számú alkalommal, növekvő várakozással.
- Ha a kérés elment, de az eredménye nem állapítható meg biztosan, az NPU nem kattint újra, hanem „unconfirmed” néven külön jelzi. Egy elveszett visszajelzés miatt nem küld második jelentkezést.

A felvétel eredményét az NPU a Neptun saját órarendtervező adataiból is visszaellenőrzi, és a már felvett tárgyakat eleve kihagyja. Ez kizárólag olvasó lekérdezés ugyanazokra a végpontokra, amelyeket a Neptun felülete magától is hív; felvételt továbbra is csak a felület `Tárgy felvétele` gombjával kezdeményez.

Lassú Neptun-betöltésnél a `Course Rush` legfeljebb 60 másodpercig várja meg az órarendtervezőt, majd a tárgy- és kurzussorok betöltését. A tervezőt a Neptun betöltés közben magától is megnyithatja, ezért az NPU minden lépés után újra megnézi a tényleges állapotot, és csak akkor nyúl a vezérlőhöz, ha az tényleg szükséges. Ha a lista így sem készül el, megáll, és nem indítja el automatikusan a helyi tartalékot. Így egy átmeneti betöltési vagy DOM-felismerési hiba nem válhat másik felvételi folyamat engedélyévé.

Az órarendtervezős folyamat minden futása alapértelmezetten részletes állapotnaplót ír a böngésző konzoljára `[NPU:planner]` előtaggal és egyedi futásazonosítóval. Minden bejegyzés egyetlen, olvasható és másolható sor. A napló fázisokat, eltelt időket, elemszámokat és eredményállapotokat tartalmaz; hozzáférési tokent, fiókadatot, tárgykódot és kurzuskódot nem. Hibajelentéshez a konzolban szűrj az előtagra, és másold ki az érintett futás sorait. A telepített verziószám az NPU panel fejlécében látszik, érdemes azt is mellékelni.

## Telepítés

1. Telepítsd a [Tampermonkey](https://www.tampermonkey.net/) böngészőbővítményt.
2. Chrome vagy Edge alatt nyisd meg a böngésző bővítménykezelőjét, és kapcsold be a Fejlesztői módot, hogy a Tampermonkey futtatni tudja a userscripteket.
3. Nyisd meg a publikus userscript buildet:
   [dist/npu.user.js](https://github.com/surilevi/neptun-powerup-userscript/raw/main/dist/npu.user.js)
4. Telepítsd a scriptet Tampermonkey-ben.
5. Nyisd meg a saját Neptun felületedet. Az NPU panel a jobb alsó sarokban jelenik meg.

## Támogatott portálútvonalak

A userscript nem konkrét egyetemi hostnevekre van bekötve. A gyakori Neptun hallgatói útvonalakat figyeli:

- `/hallgatoi/*`
- `/hallgato_ng/*`
- `/hallgatoing/*`
- `/ujhallgato/*`

Emiatt több intézményi Neptun-telepítésen is működhet külön build nélkül. A helyi Neptun-testreszabások ettől még okozhatnak eltéréseket.

## Korlátok

- A script a jelenlegi Neptun Angular/Material DOM-szerkezetére támaszkodik. Egy Neptun UI-frissítés eltörhet szelektorokat.
- A tárgy- és vizsgafelismerés heurisztikus. Szokatlan helyi jelöléseknél szükség lehet finomhangolásra.
- Az órarendtervezős folyamat nem függ a normál tárgylista első, jellemzően 50 elemétől: a tervező saját listájából olvassa ki a már hozzáadott tárgyakat. A kívánt kurzusokat azonban előzetesen neked kell a tervezőbe tenni.
- A felvételi műveletek szándékosan egymás után futnak. A Neptun gyakran rosszul kezeli a párhuzamos kéréseket.
- A `Course Rush` egy futásra szól: indulás után kikapcsolja önmagát, és ezt el is menti. Egy újratöltés így nem indít újabb felvételi kört. Legközelebbi használat előtt kapcsold be újra.
- A vizsgafunkciók az éppen megnyitott vizsgaoldalon dolgoznak. Nem járják be önállóan az összes tárgyat és vizsgaoldalt.
- Az `Infinite Session` nem jelent biztos védelmet regisztrációs időszakban. Ha a Neptun szerveroldalon érvényteleníti a munkamenetet, azt egy userscript nem tudja megakadályozni.

## Adatkezelés

- A script a saját beállításait és mentett választásait Tampermonkey-tárhelyen tárolja.
- Az órarendtervezős folyamat olvasó lekérdezéseket futtat a Neptun saját végpontjaira, hogy a felvétel eredményét ellenőrizni tudja. Ezek ugyanazok a lekérdezések, amelyeket a Neptun felülete magától is elvégez, és nem kerülnek ki a Neptun kiszolgálójáról.
- Ha a Tampermonkey tárhely-API nem érhető el, az NPU nem aktiválódik.
- Felhasználónevet és jelszót nem ment tartósan.
- A részletes debug naplózás csak akkor aktív, ha külön bekapcsolod.

## Fejlesztés

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Az általános modulok részletes debug naplózásához állítsd be ezt a böngésző konzoljában. Az órarendtervező `[NPU:planner]` diagnosztikája ettől függetlenül mindig aktív.

```js
localStorage.npu_debug = 'true'
```

Kikapcsoláshoz:

```js
localStorage.npu_debug = 'false'
```

## Jogi megjegyzés

A projekt automatizált böngésző-interakciókat végez a Neptunban, ezért ütközhet intézményi szabályokkal. A használat következményeiért mindenki maga felel.

Részletesebb jogi szöveg: [LEGAL_NOTICE.md](LEGAL_NOTICE.md)

## Licenc

MIT

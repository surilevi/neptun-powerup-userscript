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
- `Course Rush`: az órarendtervező pontos kurzusválasztásait olvassa ki, majd a látható `Tárgy felvétele` gombokat egymás után kattintja. Üres tervezőnél a helyben mentett választás lehet a tartalék.
- `Exam Planner`: naptárban mutatja a látható felvett és mentett vizsgaidőpontokat, és továbbra is el tud menteni egy választott időpontot későbbi jelentkezéshez.
- `Exam Rush`: az aktuálisan látható vizsgaoldalon végigpróbálja a mentett vizsgacélokat.
- `Infinite Session`: normál használat közben megpróbálja frissen tartani a munkamenetet. Tárgyfelvételi vagy vizsgajelentkezési roham alatt a Neptun ettől függetlenül is kidobhat.
- `Theme`: választható színkiemelés a Neptun felületén.

## Course Rush előkészítése

1. A `Tárgyfelvétel` oldalon add hozzá az összes kívánt pontos kurzust a Neptun `Órarendtervező` részéhez.
2. Az NPU panelen nyomd meg a `Preview Planner` gombot. A Safe Preview megnyithatja az órarendtervezőt, `Lista nézet`-re válthat és lenyithatja a tárgyfejléceket, de nem módosít kurzusjelölőt, tervezőállapotot vagy felvételt.
3. Ellenőrizd a kiemelt tárgykódokat, kurzuskódokat és `Tárgy felvétele` gombokat.
4. Kapcsold ki a Neptun saját tárgyfelvételi megerősítő felugró ablakát. Ezt egy olyan tárgynál tedd meg, amelyet egyébként is felvennél: a Neptun megerősítésében válaszd a „ne jelenjen meg újra” lehetőséget, majd a saját döntésed szerint fejezd be vagy szakítsd meg azt a kézi műveletet.
5. Az azonnali futtatáshoz használd az `Enroll Planner` gombot, belépés utáni futtatáshoz pedig kapcsold be a `Course Rush` kapcsolót.

Az `Enroll Planner` külön NPU-megerősítés nélkül, azonnal indul; a gomb megnyomása a látható, órarendtervezőben előkészített célok felvételének jóváhagyását jelenti. A `Course Rush` belépés után ugyanígy indul, majd azonnal kikapcsolja önmagát. Mindkét út újra ellenőrzi az egyes pontos kurzusválasztásokat, és ugyanazokat a Neptun felületi `Tárgy felvétele` gombokat használja egymás után; az NPU nem küld közvetlen, rejtett felvételi API-kérést. Egy tárgy hibája után a következő még érvényes tervezőcélokkal folytatja.

Ha a Neptun saját megerősítő ablaka mégis megjelenik, az NPU az első érintett tárgynál megáll, és a többi felvételi gombot nem kattintja meg. A helyi `Save Local`, `Preview Saved` és `Local Load + Enroll` műveletek azoknak maradnak meg tartalékként, akik nem az órarendtervezős folyamatot használják.

Lassú Neptun-betöltésnél a `Course Rush` legfeljebb 60 másodpercig vár az órarendtervező vezérlőire, majd a tárgy- és kurzussorok betöltésére. Ha ezek nem készülnek el, megáll, és nem indítja el automatikusan a helyi tartalékot. Így egy átmeneti betöltési vagy DOM-felismerési hiba nem válhat másik felvételi folyamat engedélyévé.

Az órarendtervezős folyamat minden futása alapértelmezetten részletes, másolható állapotnaplót ír a böngésző konzoljára `[NPU:planner]` előtaggal és egyedi futásazonosítóval. A napló fázisokat, eltelt időket, elemszámokat és eredményállapotokat tartalmaz; hozzáférési tokent, fiókadatot, tárgykódot és kurzuskódot nem. Hibajelentéshez a konzolban szűrj az előtagra, és másold ki az érintett futás sorait.

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
- A vizsgafunkciók az éppen megnyitott vizsgaoldalon dolgoznak. Nem járják be önállóan az összes tárgyat és vizsgaoldalt.
- Az `Infinite Session` nem jelent biztos védelmet regisztrációs időszakban. Ha a Neptun szerveroldalon érvényteleníti a munkamenetet, azt egy userscript nem tudja megakadályozni.

## Adatkezelés

- A script a saját beállításait és mentett választásait Tampermonkey-tárhelyen tárolja.
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

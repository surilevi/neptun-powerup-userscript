# Neptun PowerUp!

Magyar nyelvű Tampermonkey userscript Neptunhoz. A célja egyszerű: kevesebb ismétlődő kattintás, kevesebb kapkodás tárgyfelvételkor és vizsgajelentkezéskor.

A script nem helyetted dönt, és nem kerül meg Neptun-szabályokat. A már kiválasztott kurzusokat és vizsgaidőpontokat tudja elmenteni, visszatölteni, majd kérésre végigkattintani. Emellett próbálja életben tartani az aktív munkamenetet, hogy ritkábban dobjon ki a Neptun.

> Fontos: ez a projekt böngészőben futó automatizálást végez a Neptun felületén. Csak saját felelősségre használd, és vedd figyelembe a saját intézményed szabályait.

## Mire jó?

- `Course Store`: elmenti a kijelölt kurzusokat, később pedig visszatölti őket.
- `Course Rush`: a mentett tárgyválasztást visszatölti, majd sorban megpróbálja felvenni a tárgyakat.
- `Exam Quick Signup`: elment egy választott vizsgaidőpontot, majd később egy kattintással megpróbál jelentkezni rá.
- `Exam Rush`: az aktuálisan látható vizsgaoldalon végigpróbálja a mentett vizsgacélokat.
- `Infinite Session`: megpróbálja frissen tartani a munkamenetet.
- `Theme`: választható színkiemelés a Neptun felületén.

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
- A felvételi műveletek szándékosan egymás után futnak. A Neptun gyakran rosszul kezeli a párhuzamos kéréseket.
- A vizsgafunkciók az éppen megnyitott vizsgaoldalon dolgoznak. Nem járják be önállóan az összes tárgyat és vizsgaoldalt.

## Adatkezelés

- A script a saját beállításait és mentett választásait Tampermonkey-tárhelyen tárolja.
- Felhasználónevet és jelszót nem ment tartósan.
- A részletes debug naplózás csak akkor aktív, ha külön bekapcsolod.

## Fejlesztés

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Részletes debug naplózáshoz állítsd be ezt a böngésző konzoljában:

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

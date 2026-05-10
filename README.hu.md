# Neptun PowerUp!

Magyar nyelvu Tampermonkey userscript, ami a Neptunban vegzett ismetlodo muveleteket gyorsitja.

A projekt celja nem az, hogy mindent atvegyen helyetted, hanem hogy a faraszto kattintasokat es a versenyhelyzetben kellemetlen ujravegzeseket csokkentse. Jelenleg a fo funkciok a kurzusvalasztas mentese es visszatoltese, a gyors targyfelvetel, a mentett vizsgaidopontok gyors ujrajelentkezese, valamint a munkamenet eletben tartasa.

> Fontos: a script automatizalja a Neptun egyes reszeit. Mindenki csak sajat felelossegere, a sajat intezmenye szabalyait figyelembe veve hasznalja.

## Mire jo?

- `Course Store`: elmented a kijelolt kurzusokat, majd kesobb visszatoltod oket.
- `Course Rush`: a mentett targyvalasztast egy kattintassal visszatolti es vegigprobalja a felvetelt.
- `Exam Quick Signup`: elmented a preferalt vizsgaidopontot, majd kesobb gyorsan ujrajelentkezel ra.
- `Exam Rush`: a lathato vizsgaoldalon vegigprobalja a mentett vizsgacelokat.
- `Infinite Session`: megprobalja eletben tartani a munkamenetet, hogy kevesebbszer dobjon ki a Neptun.
- `Pink Mode`: opcionális kinezet testreszabas.

## Telepites

1. Telepitsd a [Tampermonkey](https://www.tampermonkey.net/) kiegeszitot.
2. Nyisd meg a publikus buildet innen:
   [dist/npu.user.js](https://github.com/surilevi/neptun-powerup-userscript/raw/main/dist/npu.user.js)
3. Telepitsd a scriptet Tampermonkey-be.
4. Nyisd meg a sajat Neptun feluletedet. Az NPU panel a jobb also sarokban jelenik meg.

## Tamasztott portalcsaladok

A userscript nem egyetlen hostnevre van behuzalozva, hanem a szokasos Neptun URL-csaladokra:

- `/hallgatoi/*`
- `/hallgato_ng/*`
- `/hallgatoing/*`
- `/ujhallgato/*`

Ez azt jelenti, hogy tobb egyetemi telepitesen is mukodhet uj build nelkul, de a Neptun helyi testreszabasai tovabbra is okozhatnak kulonbsegeket.

## Korlatozasok

- A script a jelenlegi Neptun Angular/Material DOM szerkezetere tamaszkodik. Egy UI-frissites konnyen eltörhet valamit.
- A targy- es vizsgafelismeres heurisztikus. Kulonosen szokatlan helyi jeloleseknel kellhet utolagos finomhangolas.
- A felveteli muveletek szandekosan szekvencialisak. A Neptun gyakran rosszul toleralja az egyszerre kilott parhuzamos kerelmeket.
- A vizsgafunkciok a jelenleg megnyitott vizsgaoldalon dolgoznak. Nem navigalnak teljesen onalloan az osszes lehetseges oldal kozott.

## Adatkezeles

- A script a sajat beallitasait es mentett valasztasait Tampermonkey taroloban tartja.
- Felhasznalonevet es jelszot nem tarol tartosan.
- Debug mod csak akkor aktiv, ha ezt kulon bekapcsolod.

## Fejlesztes

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Ha reszletes debug informaciot szeretnel, a bongeszo konzolban allitsd be ezt:

```js
localStorage.npu_debug = 'true'
```

Kikapcsolashoz:

```js
localStorage.npu_debug = 'false'
```

## Jogi megjegyzes

A projekt automatizalt bongeszo-interakciokat vegez a Neptunban, ezert intezmenyi szabalyokba utkozhet. A hasznalat kovetkezmenyeiert mindenki maga felel.

Reszletesebb jogi szoveg: [LEGAL_NOTICE.md](LEGAL_NOTICE.md)

## Licenc

MIT

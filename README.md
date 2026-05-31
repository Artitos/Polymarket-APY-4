# PM·SCAN — Polymarket Holding Rewards Scanner

Escanea el [Gamma API público de Polymarket](https://docs.polymarket.com) y lista los
markets que tienen **Holding Rewards** activos: el programa por el que Polymarket paga
~**4.00% APY** (anualizado, distribuido diariamente) por mantener posiciones en una
lista curada de markets elegibles.

- 🟢 Hosteable **gratis** en Vercel (plan Hobby)
- 🟢 Sin API keys (el Gamma API de discovery es público)
- 🟢 Una sola función: escanear markets nuevos y existentes y filtrar los que pagan el reward

---

## Cómo funciona

```
Browser ──▶ /api/scan (serverless, corre en el server) ──▶ gamma-api.polymarket.com/markets
```

El fetch a Polymarket se hace **del lado del server** (en `app/api/scan/route.ts`), no
desde el browser, para evitar problemas de CORS. La lógica está en `lib/polymarket.ts`:

1. Trae markets abiertos en páginas de 500 (`closed=false&active=true`), ordenados por
   volumen para que los markets con reward (que son de alto volumen) aparezcan primero.
2. Por cada market corre `detectHoldingReward()`, que busca el flag de holding reward.
3. Calcula probabilidad implícita del favorito, días a resolución, liquidez, y un
   **Bond APY** de referencia (rendimiento de comprar el favorito y mantener hasta $1).
4. Filtra por APY mínimo / probabilidad / liquidez y devuelve la lista ordenada.

### Sobre la detección del campo

Polymarket expone por market si tiene holding rewards habilitados, pero el **nombre
exacto del campo puede cambiar** entre versiones del API. Por eso la detección es
defensiva: revisa una lista de nombres candidatos (`holdingRewardsEnabled`,
`holdingRewardRate`, etc.) y además escanea el objeto en profundidad buscando cualquier
clave que matchee el patrón de "holding reward".

> 💡 **Para fijar el campo exacto:** activá el toggle **"modo debug"** en la UI, mirá la
> respuesta cruda de `/api/scan?includeNonReward=true` en las DevTools, y fijate el campo
> `evidence` de un market que sepas que es elegible (p. ej. el de las presidenciales 2028
> de EE.UU.). Una vez identificado, podés afinar `detectHoldingReward()` para que filtre
> exactamente por ese campo.

---

## Desarrollo local

```bash
npm install
npm run dev
# abrí http://localhost:3000
```

---

## Deploy a Vercel + GitHub (gratis)

### 1. Subir a GitHub

```bash
git init
git add .
git commit -m "PM·SCAN: Polymarket holding rewards scanner"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/pmscan.git
git push -u origin main
```

### 2. Deploy en Vercel

1. Entrá a [vercel.com](https://vercel.com) y logueate con tu cuenta de GitHub.
2. **Add New → Project** y seleccioná el repo `pmscan`.
3. Vercel detecta Next.js automáticamente. No hace falta configurar nada ni variables
   de entorno.
4. **Deploy.** En ~1 minuto tenés tu URL pública (`https://pmscan-xxx.vercel.app`).

Cada `git push` a `main` redeploya solo.

---

## Configuración de red importante

El plan Hobby de Vercel da hasta **60s** por función serverless, lo que alcanza de sobra.
Si escaneás muchas páginas (20 = ~10.000 markets) y se acerca al límite, bajá el número
de páginas en la UI. El parámetro está en `app/api/scan/route.ts` (`maxDuration = 60`).

---

## Parámetros del endpoint

`GET /api/scan`

| Param              | Default | Descripción                                            |
| ------------------ | ------- | ------------------------------------------------------ |
| `minApy`           | `4`     | APY mínimo (%) para incluir el market                  |
| `minProb`          | `0`     | Probabilidad implícita mínima del favorito (%)         |
| `minLiquidity`     | `0`     | Liquidez mínima en USDC                                |
| `maxPages`         | `6`     | Páginas de 500 markets a escanear (1–20)               |
| `includeNonReward` | `false` | Si `true`, incluye markets sin reward (modo debug)     |

---

## Disclaimer

El Holding Reward es una **tasa variable** y la lista de markets elegibles la define
Polymarket. El **Bond APY** que muestra la tabla es solo de referencia y **no es libre
de riesgo**. Esto no es asesoramiento financiero. Verificá la tasa y la elegibilidad en
la página del market antes de operar.

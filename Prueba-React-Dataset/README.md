# Monitor de ignición (React + Vite)

Dos secciones:
- **Asistente**: tabla filtrable de las 697 pruebas (descarga CSV) y un asistente local en español.
- **Riesgo de incendio**: escenario ajustable, probabilidad de ignición con nivel de riesgo y umbral de alarma,
  pruebas reales más parecidas, palancas de prevención y mapa de riesgo de dos parámetros.

## Ejecutar
```bash
npm install
npm run dev            # http://localhost:5173
npm run build:single   # genera dist-single/index.html (un solo archivo, se abre con doble clic)
```
Requiere Node 18 o superior.

## Datos y modelo (carpeta python/)
```bash
python prep_v2.py --psi10 "PSI-10_Raw Data_Final ACME Chamber Calculator - 2019-04-09 to 2019-08-13.xlsx" \
                          "PSI-10_Raw_Data_Final_ACME.xlsx" \
                  --psi159 "PSI-159_Raw_Data_Final_ACME.xlsx" --out ..
python train_export.py     # reentrena y regenera src/data/*.json y la columna prob_cv
```
Necesita pandas, numpy, scipy, scikit-learn y openpyxl. `--psi10` acepta varios archivos porque la calculadora de PSI-10
viene partida por periodos (2019 y 2021-2022); la de 2019 trae las únicas pruebas de etileno en llama normal.

`train_export.py` entrena una **regresión logística**, la valida dejando fuera cada día de pruebas y exporta los
coeficientes a JSON. `src/lib/modelCore.js` la evalúa en el navegador (coincide con Python a 1e-16).

- Los litros del quemador entran en escala logarítmica (los primeros mililitros importan más que los últimos).
- Los signos de algunos coeficientes están fijados por la física (`SIGNS`): más O2 o más combustible no pueden bajar la
  probabilidad y el N2 o el CO2 no pueden subirla. Sin esto el modelo aprendía tendencias al revés por el diseño del
  experimento (por ejemplo, el CO2 se acumula a lo largo del día). En estos datos el O2 y el CO2 de la cámara quedan sin
  efecto. Cuesta ~0.01 de AUC; para quitarlo, `SIGNS = {}`.
- Se eligió sobre el gradient boosting que había antes porque la app sirve para explorar: la probabilidad cambia de forma
  continua al mover un control y sigue una tendencia fuera de lo ensayado (los árboles dan escalones y se quedan planos
  en el borde). En validación por día predicen casi igual.

## Reglas físicas (src/lib/model.js)
Antes de consultar el modelo se aplican dos reglas: sin combustible (quemador y cámara casi en cero) o sin oxidante
(O2 de cámara y de quemador casi en cero) la probabilidad es 0 % y la app lo indica. Los umbrales están en `GUARD`;
se validaron con los datos reales (bloquean 5 pruebas y ninguna encendió).

## Cómo leer los resultados
- AUC 0.85 y exactitud 79 % en PSI-159 (frente a 66 % de adivinar siempre "enciende"). PSI-10 enciende el 92 %, por eso
  el AUC global (0.90) luce mejor de lo que es. Las cifras de la app salen de `src/data/meta.json` y se actualizan solas.
- Es una alerta de apoyo: el modelo aprendió correlaciones de pruebas con encendedor forzado en una cámara pequeña,
  no física de combustión ni riesgo en una cabina.
- Fuera de lo ensayado la app **sí** da el porcentaje, marcado como "Extrapolación": es la tendencia del modelo, no un
  resultado respaldado por pruebas. La franja bajo cada control marca lo que NASA probó y el mapa de riesgo puede
  ampliarse fuera de esa zona. El botón "Llevar al rango ensayado" ajusta los valores si quieres una estimación respaldada.

## El asistente
Funciona sin internet, dentro del navegador. `src/lib/chat.js` entiende la pregunta con reglas (combustible, tipo de
llama, presión en psia/atm/bar/kPa, % de O2, CO2 o combustible, litros o mililitros de cada gas) y responde llamando a
las herramientas de `src/lib/tools.js`, que usan el mismo código que el simulador. Así no puede inventarse un número;
debajo de cada respuesta se ve qué herramienta consultó.

| Herramienta | Qué hace |
|---|---|
| `buscar_pruebas` | filtra el dataset y devuelve conteos y tasa de ignición |
| `predecir_ignicion` | corre el modelo entrenado (marca si es extrapolación) |
| `comparar_combustibles` | tasas por combustible y tipo de llama, constantes químicas y paradoja de Simpson |
| `rangos_ensayados` | entre qué valores ensayó NASA cada variable |
| `resumen_dataset` | totales, origen, calidad del modelo y peso de cada variable |

Recuerda el último escenario, así que después de una estimación se puede seguir con "¿y si subo la presión a 30?",
"y con 300 ml de nitrógeno" o "¿cómo bajo el riesgo?".

## Para trabajar en equipo con git
El repositorio NO debe incluir `node_modules`. Ya hay un `.gitignore` que lo excluye.
Cada persona, después de clonar o hacer pull, corre:

    npm install
    npm run dev

Si `node_modules` llegó a subirse al repositorio, hay que sacarlo una sola vez:

    git rm -r --cached node_modules dist dist-single
    git commit -m "Saca node_modules del repositorio"
    git push

Y cada compañero borra su carpeta `node_modules` y vuelve a correr `npm install`.

Si el puerto 5173 está bloqueado en Windows (error EACCES al levantar el servidor):

    npm run dev -- --port 3000

## Identidad del equipo

La cabecera lleva el nombre del equipo y el logo. Para cambiarlos:

- **Nombre**: la constante `TEAM` al inicio de `src/App.jsx`.
- **Logo**: reemplaza `src/assets/logo.png` por tu archivo y vuelve a construir.
  El que viene es un recorte de baja resolución sacado de una captura, sirve de
  provisional pero conviene poner el PNG original (idealmente cuadrado y con fondo
  transparente, de 256 px o más).

### Paleta 60/30/10
Las variables de color están al inicio de `src/styles.css`:

- **60 % blanco**: `--surface` y `--page`, el fondo y los paneles.
- **30 % azul**: `--brand` (#123f90) en la cabecera, `--accent` en controles, datos y gráficas.
- **10 % rojo**: `--red` solo en la pestaña activa, las alertas y los niveles de riesgo alto y crítico.

Los cuatro colores de la escala de riesgo pasan la validación de contraste y de
daltonismo (deuteranopía y tritanopía), y además cada nivel lleva una forma distinta,
así que nunca dependen solo del color.

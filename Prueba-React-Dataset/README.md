# Monitor de ignición

Dos secciones:

- **Monitor preventivo**: escenario ajustable, probabilidad de ignición con nivel de riesgo, pruebas reales más parecidas,
  palancas de prevención, mapa de riesgo de dos parámetros y repetición ("replay") de un día real de pruebas con alarmas.
- **Buscador y asistente**: tabla filtrable de las 483 pruebas (descarga CSV) y un asistente local en español.

## Ejecutar

```bash
npm install
npm run dev            # http://localhost:5173
npm run build:single   # genera dist-single/index.html (un solo archivo, se abre con doble clic)
```

Requiere Node 18 o superior.

## Datos y modelo (carpeta python/)

```bash
python prep_v2.py --psi10 "PSI-10_Raw Data_Final ACME.xlsx" --psi159 "PSI-159_Raw Data_Final ACME.xlsx" --out ..
python train_export.py     # reentrena y regenera src/data/*.json y la columna prob_cv
```

Necesita pandas, numpy, scikit-learn y openpyxl. Lee `dataset_limpio.csv`, entrena un gradient boosting
(100 árboles, profundidad 3), lo valida dejando fuera cada día de pruebas y exporta los árboles a JSON.
`src/lib/modelCore.js` los evalúa en el navegador (coincide con scikit-learn a 1e-16).

## Reglas físicas (src/lib/model.js)

Antes de consultar el modelo se aplican dos reglas: sin combustible (quemador y cámara casi en cero) o sin oxidante
(O2 de cámara y de quemador casi en cero) la probabilidad es 0 % y la app lo indica. Los umbrales están en `GUARD`;
se validaron con los datos reales (bloquean 5 pruebas y ninguna encendió).

## Cómo leer los resultados

- AUC 0.87 y exactitud 79 % en PSI-159 (frente a 66 % de adivinar siempre "enciende"). PSI-10 enciende el 97 %, por eso
  el AUC global (0.91) luce mejor de lo que es.
- Es una alerta de apoyo: el modelo aprendió correlaciones de pruebas con encendedor forzado en una cámara pequeña,
  no física de combustión ni riesgo en una cabina.
- El simulador avisa cuando un valor sale de lo ensayado, cuando la combinación no se parece a ninguna prueba real
  y cuando no hay datos de ese combustible y tipo de llama (por ejemplo etileno en llama normal).

## El asistente

Reglas en `src/lib/chat.js` (sin IA generativa ni internet). Para usar un LLM real, llama a la API desde un servidor
propio; nunca pongas la clave dentro de código que corre en el navegador.

## Cambios recientes (fuera de lo ensayado)

- Los controles muestran solo lo que existe en cada tipo de llama. Normal: cámara con aire (O2, N2) y el combustible entra por el quemador. Inversa: cámara con combustible y el O2 entra por el quemador.
- Si el escenario sale del rango que NASA probó, no se muestra porcentaje ("Fuera de lo ensayado"). El botón "Llevar al rango ensayado" ajusta los valores.
- Regla física: sin combustible o sin oxidante, la probabilidad es 0 %.

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

## Asistente con Gemini (opcional)

Hay un solo asistente. Sin clave responde con reglas, sin internet y sin inventar nada.
Con una clave de Gemini conectada entiende preguntas libres, y si Gemini falla por cualquier
motivo vuelve a las reglas en la misma respuesta.

Las llamadas a Google se reintentan hasta tres veces con espera creciente cuando devuelve
429 o 5xx, que son errores pasajeros ("el modelo está saturado"), y si un modelo sigue
saturado se prueba con el siguiente de tu cuenta antes de rendirse.

### Cómo activarlo

1. Entra a https://aistudio.google.com/apikey y crea una clave gratuita.
2. En la app, cambia el asistente a "Gemini" y pega la clave.
3. La app le pregunta a Google qué modelos admite tu clave y elige el mejor sola.
   Si prefieres otro, aparece una lista desplegable para escogerlo.

Los nombres de los modelos de Google cambian cada pocos meses, así que el proyecto no
los trae escritos: los consulta con `GET /v1beta/models`. Por eso no se rompe cuando
Google retira un modelo viejo.

La clave se guarda **solo en tu navegador** (localStorage) y viaja directo a Google. Nunca
está en el código ni se sube al repositorio, así que puedes publicar el proyecto sin riesgo.
Cada persona que use la app pone la suya.

### Por qué no inventa números

El modelo no recibe el dataset para que lo calcule. Recibe cinco herramientas
(`src/lib/tools.js`) que llaman al mismo código que usa el resto de la app:

| Herramienta             | Qué hace                                                |
| ----------------------- | ------------------------------------------------------- |
| `buscar_pruebas`        | filtra el dataset y devuelve conteos y tasa de ignición |
| `predecir_ignicion`     | corre el modelo entrenado de verdad                     |
| `comparar_combustibles` | tasas por combustible más sus constantes químicas       |
| `rangos_ensayados`      | entre qué valores ensayó NASA cada variable             |
| `resumen_dataset`       | totales, origen y calidad del modelo                    |

Gemini pide los datos, recibe resultados reales calculados por esta app, y solo redacta.
Si pregunta por algo fuera del rango ensayado, la herramienta devuelve `fuera_de_rango`
y el modelo tiene instrucciones de no dar ningún porcentaje.

Debajo de cada respuesta aparece qué herramientas consultó, para que se pueda verificar.

### Si falla

Si la clave es inválida, se acaba la cuota o no hay internet, el asistente de reglas
responde la misma pregunta automáticamente. La app nunca se queda muda.

### NUNCA hagas esto

No pongas la clave en el código, ni en un archivo `.env` con prefijo `VITE_`. Vite mete
todo lo que empiece con `VITE_` dentro del JavaScript que descarga el navegador, así que
cualquiera que abra las herramientas de desarrollo la vería. Los bots que rastrean GitHub
buscando claves filtradas las encuentran en minutos.

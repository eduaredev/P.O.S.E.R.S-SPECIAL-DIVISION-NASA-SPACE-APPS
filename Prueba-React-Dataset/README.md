# Monitor de ignición (React + Vite)

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

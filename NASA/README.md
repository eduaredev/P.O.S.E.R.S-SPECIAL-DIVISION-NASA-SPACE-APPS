# Centro de datos NASA (prototipo)

React + Vite. Dos vistas:

- **Asistente**: chatbot por palabras clave; lo que pides aparece como panel a la derecha.
- **Riesgo de incendio**: mezcla de combustibles y gases con sliders y probabilidad estimada.

## Ejecutar

```bash
npm install
npm run dev
```

Abre la dirección que muestre la terminal (normalmente http://localhost:5173).

## Estructura

- `src/components/Chat.jsx`: reglas del asistente (REGLAS).
- `src/components/Resultados.jsx`: paneles que puede mostrar (PANELES).
- `src/components/CalculadoraIncendio.jsx` y `src/lib/incendio.js`: interfaz y cálculo.
- `src/data/ejemplo.js`: datos de ejemplo, a reemplazar con api.nasa.gov.

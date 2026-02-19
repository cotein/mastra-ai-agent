import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";

const ADDRESS_EXTRACTION_PROMPT = `
Eres un experto en identificar y normalizar direcciones postales a partir de contenido inmobiliario.

TU TAREA PRINCIPAL:
Extraer la dirección postal de una URL de propiedad, priorizando el análisis de la estructura de la URL.

### ALGORITMO PARA URLs DE ZONAPROP:
Si la URL pertenece a Zonaprop, sigue estrictamente este procedimiento de limpieza de texto sobre la URL misma:

1. **Localizar el segmento clave**: Identifica la parte de la URL que está después de \`/clasificado/\` y antes del primer guion que precede al número de ID (ejemplo: \`-56673355\`).
2. **Eliminar el prefijo de operación**: Ignora los primeros caracteres que terminan en 'in' (como \`vecllcin-\`, \`alclapin-\`, \`veclcain-\`). Estos representan el tipo de propiedad y operación, no la dirección.
3. **Limpieza de Guiones**: Reemplaza todos los guiones medios (-) por espacios.
4. **Capitalización**: Convierte el texto resultante a 'Title Case' (Primera letra de cada palabra en mayúscula).
5. **Validación**: El resultado debe contener el nombre de la calle y la altura numérica.

### EJEMPLOS (FEW-SHOT):

**Caso 1:**
URL: \`https://www.zonaprop.com.ar/propiedades/clasificado/vecllcin-av-meeks-158-56673355.html\`
Extracción: "Av Meeks 158"

**Caso 2:**
URL: \`https://www.zonaprop.com.ar/propiedades/clasificado/alclapin-gorriti-368-56339731.html\`
Extracción: "Gorriti 368"

### FORMATO DE SALIDA (JSON):
Debes responder ÚNICAMENTE con un objeto JSON válido con la siguiente estructura exacta.
No incluyas markdown, ni bloques de código, solo el JSON raw.

Estructura requerida:
{
  "filters": [
    ["address", "contains", "DIRECCION_EXTRAIDA"] 
  ],
  "current_localization_type": "country",
  "current_localization_id": 1, 
  "price_from": 0,
  "price_to": 99999999,
  "operation_types": [1, 2, 3],
  "property_types": [1, 2, 3, 4, 5, 6, 7, 8]
}

Donde "DIRECCION_EXTRAIDA" es la dirección que obtuviste del análisis. 
Si no puedes extraer ninguna dirección, devuelve null en ese campo o maneja el error, pero intenta siempre inferir algo de la URL.
`;

export const addressExtractionAgent = new Agent({
  id: "address-extraction-agent",
  name: "Address Extraction Agent",
  instructions: ADDRESS_EXTRACTION_PROMPT,
  model: openai('gpt-4o-mini'),
});

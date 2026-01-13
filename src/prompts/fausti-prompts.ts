import { OperacionTipo, ClientData } from "./../types";
import { frasesRevisareLink, frasesDisponibilidad , frasesSolicitudDatos } from "../helpers/frases";
// --- AUDITORÍA DE DATOS ---
function auditMissingFields(datos: ClientData): string[] {
  const missing: string[] = [];
  // Valida: vacío, undefined o placeholder
  const isInvalid = (val: string | undefined) => !val || val === '' || val === 'Preguntar' || val === 'Ver chat';

  if (isInvalid(datos.nombre)) missing.push("NOMBRE");
  if (isInvalid(datos.apellido)) missing.push("APELLIDO");
  if (isInvalid(datos.email)) missing.push("EMAIL");
  if (isInvalid(datos.telefono)) missing.push("TELÉFONO");

  return missing;
}

function obtenerFraseAleatoriaRevisarLink(): string {
  const indiceAleatorio = Math.floor(Math.random() * frasesRevisareLink.length);
  return frasesRevisareLink[indiceAleatorio];
}

function obtenerFraseAleatoriaDisponibilidad(): string {
  const indiceAleatorio = Math.floor(Math.random() * frasesDisponibilidad.length);
  return frasesDisponibilidad[indiceAleatorio];
}

function obtenerFraseAleatoriaSolicitudDatos(): string {
  const indiceAleatorio = Math.floor(Math.random() * frasesSolicitudDatos.length);
  return frasesSolicitudDatos[indiceAleatorio];
}

// --- I. IDENTIDAD ---
const CORE_IDENTITY = `
# I. IDENTIDAD & ROL
Eres NICO, asistente de IA de Fausti Propiedades.

### 📱 ESTILO DE COMUNICACIÓN (WHATSAPP MODE)
Actúa como una persona real escribiendo rápido por WhatsApp:
- **FORMATO**: Usa minúsculas casi siempre. Evita puntos finales en oraciones cortas.
- **TONO**: Casual, empático, directo ("vos", "dale", "genial").
- **EMOJIS**: Pocos, solo si suma onda (1 o 2 max).
- **PROHIBIDO**: No seas robótico. No uses "Estimado", "Quedo a la espera", "Cordialmente".
- **CLIVAJES**: Si tienes que decir varias cosas, usa oraciones breves y directas.

### Reglas Operativas
- **Regla Suprema**: Tu comportamiento depende 100% del "TIPO DE OPERACIÓN".
- **Privacidad**:
  1. TERCEROS: JAMÁS reveles datos de otros.
  2. USUARIO: Si pregunta "¿Qué sabes de mí?", responde SOLO con lo que ves en "DATOS ACTUALES".
`;

// Helper fecha
function getTemporalContext() {
  return new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export const dynamicInstructions = (datos: ClientData, op: OperacionTipo) => {
  const opNormalizada = op ? op.toUpperCase() : 'INDEFINIDO';
  const missingFields = auditMissingFields(datos);
  
  // --- II. ESTADO DEL USUARIO ---
  let statusBlock = "";

  if (missingFields.length > 0) {
    const missingString = missingFields
        .map(f => f.toLowerCase())
        .join(', ')
        .replace(/, ([^,]*)$/, ' y $1');

    statusBlock = `
## 🚨 ESTADO: DATOS INCOMPLETOS
Faltan: ${missingFields.join(', ')}.

### ⚡ TU OBJETIVO:
Pide amablemente los datos faltantes (${missingString}) para poder avanzar.
Hazlo de forma conversacional y natural, integrado en tu respuesta (ej: "${obtenerFraseAleatoriaSolicitudDatos()} nombre y apellido?").
(NO inventes datos. NO preguntes uno a uno).
    `;
  } else {
    statusBlock = `
## ✅ ESTADO: FICHA COMPLETA
Procede con el protocolo operativo.
    `;
  }

  // --- III. PROTOCOLO OPERATIVO ---
  let protocolBlock = '';

  if (opNormalizada === 'ALQUILAR') {
      protocolBlock = `
# III. FLUJO: ALQUILER (OBJETIVO: CITA)
1. **Validación**: Celebra la elección ("¡Excelente opción!").
2. **Acción**: Pregunta DIRECTO: **${obtenerFraseAleatoriaDisponibilidad()}**
   - Usa 'get_available_slots'.
   - NO asumas horarios.
3. **Cierre**: Una vez acordado, agenda con 'create_calendar_event'.
4. **PROHIBICIÓN**: BAJO NINGUNA CIRCUNSTANCIA utilices la herramienta \`potential_sale_email\`.
      `;
  } 
  else if (opNormalizada === 'VENDER') {
      protocolBlock = `
# III. FLUJO: VENTA (OBJETIVO: DERIVAR)
1. **Acción**: usa 'potential_sale_email'.
2. **Despedida**: "Genial, en el día te contactamos por la compra. ¡Gracias! 😊"
3. **Fin**: Cierra la conversación.
      `;
  }

  return `
  ${CORE_IDENTITY}

  # II. DATOS ACTUALES
  - Nombre: ${datos.nombre || 'No registrado'}
  - Apellido: ${datos.apellido || 'No registrado'}
  - Email: ${datos.email || 'No registrado'}
  - Teléfono: ${datos.telefono || 'No registrado'}
  
  ${statusBlock}

  ${protocolBlock}

  - Fecha: ${getTemporalContext()}
  `;
};
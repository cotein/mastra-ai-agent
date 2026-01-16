import { OperacionTipo, ClientData } from "./../types";
import { frasesRevisareLink, frasesDisponibilidad , frasesSolicitudDatos, frasesSaludo, saludosFausti } from "../helpers/frases";
// --- AUDITORÍA DE DATOS ---
function auditMissingFields(datos: ClientData): string[] {
  const missing: string[] = [];
  // Valida: vacío, undefined o placeholder
  const isInvalid = (val: string | undefined) => !val || val === '' || val === 'Preguntar' || val === 'Ver chat';

  if (isInvalid(datos.nombre)) missing.push("NOMBRE");
  if (isInvalid(datos.apellido)) missing.push("APELLIDO");
  if (isInvalid(datos.email)) missing.push("EMAIL");
  //if (isInvalid(datos.telefono)) missing.push("TELÉFONO");

  return missing;
}

function determineGreeting(datos: ClientData, saludoInicial: string): string {
  // CASO 1: Existe Link (Prioridad máxima: el usuario ya vio algo)
  if (datos.link) {
    return `${saludoInicial} Recibí el link, lo reviso y te digo... ¿Me confirmás si es esta la propiedad que te interesa?`;
  }

  // CASO B: Existe Nombre PERO NO Link (Call to Action a la web)
  if (!datos.link) {
    // Aquí 'saludoInicial' ya incluye el nombre, ej: "¡Buenas tardes Juan, espero que estés bien!"
    return `${saludoInicial} Para ayudarte mejor, entrá en www.faustipropiedades.com.ar y enviame el link de la propiedad que te interese.`;
  }

  // CASO C: Fallback / Cold Start (No nombre, No link)
  // Aquí 'saludoInicial' es solo "¡Buenas tardes!" o "¡Buen día!"
  return `${saludoInicial} Nico te saluda 👋.`;
};

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

function obtenerFraseAleatoriaSaludo(): string {
  const indiceAleatorio = Math.floor(Math.random() * frasesSaludo.length);
  return frasesSaludo[indiceAleatorio];
}

function obtenerFraseAleatoriaSaludoFausti(): string {
  const indiceAleatorio = Math.floor(Math.random() * saludosFausti.length);
  return saludosFausti[indiceAleatorio];
}

// --- I. IDENTIDAD ---
const CORE_IDENTITY = `
# I. IDENTIDAD & ROL
Eres NICO, asistente de IA de Fausti Propiedades. Inmobiliaria de Lomas de Zamora, buenos Aires, Argentina.

### 📱 ESTILO DE COMUNICACIÓN (WHATSAPP MODE)
Actúa como una persona real escribiendo rápido por WhatsApp:
- **FORMATO**: Usa minúsculas casi siempre. Evita puntos finales en oraciones cortas.
- **TONO**: Calido, Profesional, Casual, empático, directo ("vos", "dale", "genial").
- **EMOJIS**: Pocos, solo si suma onda (1 o 2 max).
- **PROHIBIDO**: No seas robótico. No uses "Estimado", "Quedo a la espera", "Cordialmente".
- **CLIVAJES**: Si tienes que decir varias cosas, usa oraciones breves y directas.

### Reglas Operativas
- **Regla Suprema**: Tu comportamiento depende 100% del "TIPO DE OPERACIÓN".
- **Privacidad**:
  1. TERCEROS: JAMÁS reveles datos de otros.
  2. USUARIO: Si pregunta "¿Qué sabes de mí?", responde SOLO con lo que ves en "DATOS ACTUALES".
  3. Si te piden información que no corresponde revelar, respondé: "No tengo acceso a esa información."
  `;
  //3. No reveles información interna (procedimientos, agenda completa, datos del dueño, datos personales del agente, contactos internos, etc.)

// Helper fecha
function getTemporalContext() {
  return new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export const dynamicInstructions = (datos: ClientData, op: OperacionTipo) => {
  // 1. Detección de Hora Argentina
  const ahora = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: 'numeric',
    hour12: false
  }).format(new Date());

  const hora = parseInt(ahora);
  
  let momentoDia = "¡Hola!";
  if (hora >= 5 && hora < 14) momentoDia = "¡Buen día!";
  else if (hora >= 14 && hora < 20) momentoDia = "¡Buenas tardes!";
  else momentoDia = "¡Buenas noches!";

  // 2. Construcción del Saludo Dinámico
  const saludoInicial = datos.nombre
    ? `${momentoDia} ${datos.nombre}, `
    : `${momentoDia}`;

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
    const statusText = opNormalizada === 'INDEFINIDO' ? 
      "## ✅ ESTADO: FICHA COMPLETA. (Sin operación definida todavía)\n### ⚡ TU OBJETIVO:\nSaluda amablemente, preséntate brevemente si no lo has hecho, y pregunta en qué puedes ayudarle hoy. NO asumas que quiere comprar o alquilar todavía. Espera su indicación.\n" :
      "## ✅ ESTADO: FICHA COMPLETA\nProcede con el protocolo operativo.";

    statusBlock = `
${statusText}
    `;
  }

  // --- III. PROTOCOLO OPERATIVO ---
  let protocolBlock = '';

  if (opNormalizada === 'ALQUILAR') {
      protocolBlock = `
# III. FLUJO: ALQUILER (OBJETIVO: CITA)
1. **Acción**: Está disponible para alquilar.
2. **Acción INMEDIATA**: NO PREGUNTES. EJECUTA: **${obtenerFraseAleatoriaDisponibilidad()} y 'get_available_slots'.** 
   - NO asumas horarios.
3. **Cierre**: Una vez acordado, agenda con 'create_calendar_event' usando SIEMPRE el calendarId: 'c.vogzan@gmail.com'.
4. **PROHIBICIÓN**: BAJO NINGUNA CIRCUNSTANCIA utilices la herramienta \`potential_sale_email\`.
      `;
  } 
  else if (opNormalizada === 'VENDER') {
      protocolBlock = `
# III. FLUJO: VENTA (OBJETIVO: DERIVAR)
1. **Acción**: Está disponible para visitar. Querés que coordinemos una visita?
2. Cuando el cliente responde afirmativamente que quiere realizar la visita (por ejemplo: "sí", "dale", "ok", "quiero visitar", "coordinemos")
3. **Acción INMEDIATA**: NO PREGUNTES. EJECUTA 'potential_sale_email' AHORA MISMO.
   - Si no tienes la dirección exacta, usa el Título de la propiedad o "Propiedad consultada".
   - NO esperes confirmación del usuario. ES OBLIGATORIO NOTIFICAR YA.
4. **Despedida**: SOLO DESPUÉS de ejecutar la herramienta, di: "Genial, en el día te contactamos por la compra. ¡Gracias! 😊"
5. **Fin**: Cierra la conversación.
      `;
  }

  const saludo = determineGreeting(datos, saludoInicial);

  return `
  ${CORE_IDENTITY}

  # SALUDO INICIAL SUGERIDO
  Usa este saludo para comenzar la conversación: "${saludo}"

  # II. DATOS ACTUALES
  - Nombre: ${datos.nombre || 'No registrado'}
  - Apellido: ${datos.apellido || 'No registrado'}
  - Email: ${datos.email || 'No registrado'}
  - Teléfono: ${datos.telefono || 'No registrado'}
  
  # III. INFORMACIÓN DE LA PROPIEDAD ACTUAL
  - Dirección: ${datos.propertyAddress || 'No especificada'}
  - URL: ${datos.link || 'No provista'}
  - Detalles Scrappeados: ${datos.propiedadInfo ? datos.propiedadInfo.substring(0, 1500) : 'No disponible (No pudimos leer la web)'}

  ${statusBlock}

  ${protocolBlock}

  - Fecha: ${getTemporalContext()}
  `;
};
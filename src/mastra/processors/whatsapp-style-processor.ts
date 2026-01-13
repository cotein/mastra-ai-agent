
import { Processor } from "@mastra/core/processors";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export class WhatsAppStyleProcessor implements Processor {
  id = "whatsapp-style-processor";
  name = "whatsapp-style-processor";

  // Mastra parece requerir esto para Output Processors
  async processOutputStep(args: any) {
     // Si esto se llama, pasamos el resultado a processOutputResult o lo manejamos aquí.
     // Asumimos que args trae el contexto necesario.
     return args;
  }
  
  // Este método se usa cuando se llama a agent.generate()
  async processOutputResult(args: { messages: any[]; abort: (reason?: string) => never }) {
    // El último mensaje debería ser la respuesta del asistente que queremos modificar
    const lastMessage = args.messages[args.messages.length - 1];
    
    // Obtenemos el contenido. En Mastra, content puede ser string o array de partes.
    let textToHumanize = "";
    if (typeof lastMessage.content === 'string') {
        textToHumanize = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
        // Si es multimodal, extraemos solo el texto para simplificar
        textToHumanize = lastMessage.content.map((c: any) => c.text || "").join("");
    }

    if (!textToHumanize) return args.messages;

    try {
        const { text } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `Eres un experto en comunicación por WhatsApp. 
                     Tu trabajo es reescribir el siguiente mensaje para que suene como un humano escribiendo rápido en WhatsApp.
                     Reglas:
                     - Usa minúsculas mayormente, pero no fuerces errores ortográficos graves.
                     - IMPORTANTE: Tu objetivo principal es que parezca una conversación natural fluida.
                     - REGLA DE ORO DE SEPARACIÓN: Separa CADA idea distinta (saludo, pregunta, información) con DOBLE SALTO DE LÍNEA (\n\n). Esto es CRITICO para que salgan como mensajes separados.
                     
                     Ejemplos:
                     Input: "Hola, soy Nico. Necesito que me pases tus datos."
                     Output: 
                     "hola soy nico 👋
                     
                     necesito que me pases tus datos porfa"

                     Input: "¡Buen día! ¿En qué puedo ayudarte? Necesito tu nombre."
                     Output:
                     "buen día! 😊
                     
                     en qué puedo ayudarte??
                     
                     necesito tu nombre completo"`,
            prompt: textToHumanize,
        });

        // Actualizamos el contenido del mensaje
        // Nota: Si era array, lo aplanamos a string, lo cual para texto está bien.
        lastMessage.content = text;

        return args.messages;

    } catch (error) {
        console.error("Error en WhatsAppStyleProcessor:", error);
        return args.messages;
    }
  }

  // Implementación vacía/passthrough para streaming por si acaso se llama,
  // pero este processor está diseñado para funcionar mejor con generate() (no-streaming)
  // o habría que implementar buffering complejo.
  async processOutputStream(args: any) {
      return args.part; 
  }

  async processInput(args: any) {
      return args.messages;
  }
}

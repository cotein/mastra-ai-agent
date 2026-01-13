
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
                     - Se casual, amigable y directo.
                     - Usa emojis si cuadra, pero no abuses (1 o 2 max).
                     - Elimina formalismos excesivos como "Estimado", "Cordialmente".
                     - Mantén la información clave intacta (precios, direcciones, fechas).
                     - Si el mensaje es muy corto ("Hola"), déjalo casi igual.
                     - IMPORTANTE: Si hay múltiples ideas o párrafos distintos, sepáralos claramente con dos saltos de línea (\n\n) para poder enviarlos como mensajes separados.`,
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

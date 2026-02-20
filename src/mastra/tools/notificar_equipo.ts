import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';

// Reutilizamos tu lógica de autenticación que ya tienes en google-gmail.ts
const getGmail = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth });
};

export const notificarEquipoTool = createTool({
  id: 'notificar_equipo',
  description: 'Úsala EXCLUSIVAMENTE cuando el usuario no cumpla los requisitos de alquiler y acepte que un asesor humano lo contacte para buscar alternativas.',
  inputSchema: z.object({
    motivo: z.string().describe("Razón exacta por la que se deriva (ej: No tiene recibo de sueldo ni garantía)"),
    nombre_cliente: z.string().optional().describe("Nombre completo del interesado"),
    telefono_cliente: z.string().optional().describe("Número de teléfono de contacto"),
    url_propiedad: z.string().optional().describe("Link de la publicación"),
  }),
  execute: async (input) => {
    console.log("🛠️ Tool Invoked: notificar_equipo");
    console.log("📥 Input recibido:", JSON.stringify(input, null, 2));

    const gmail = getGmail();
    console.log("🔧 Gmail client initialized");

    const recipients = ["c.vogzan@gmail.com", "faustiprop@gmail.com", "diego.barrueta@gmail.com"];
    
    const telLimpio = input.telefono_cliente?.replace(/[^0-9]/g, '');

    const htmlBody = `
      <!DOCTYPE html> <html> <head> <style> 
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } 
      .container { width: 100%; max-width: 600px; margin: 20px auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden; } 
      .header { background-color: #e74c3c; color: #ffffff; padding: 20px; text-align: center; } 
      .content { padding: 20px; } 
      .field-label { font-weight: bold; color: #7f8c8d; text-transform: uppercase; font-size: 12px; } 
      .field-value { margin-bottom: 15px; font-size: 16px; border-bottom: 1px solid #f9f9f9; padding-bottom: 5px; } 
      .footer { background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 12px; color: #95a5a6; } 
      .tag { background-color: #f39c12; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; } 
      </style> </head> 
      <body> 
        <div class="container"> 
          <div class="header"> <h2>⚠️ Notificación de Asesoramiento</h2> <span class="tag">REQUISITOS NO CUMPLIDOS</span> </div> 
          <div class="content"> 
            <p>Hola, <strong>Nico</strong> ha notificado que un cliente no cumple con los requisitos de alquiler y ha solicitado ser contactado por un asesor humano para buscar alternativas:</p> 
            <div class="field-label">Cliente</div> <div class="field-value">${input.nombre_cliente || 'No especificado'}</div> 
            <div class="field-label">Teléfono de contacto</div> 
            <div class="field-value">
              ${input.telefono_cliente ? `<a href="https://wa.me/${telLimpio}" style="color: #27ae60; text-decoration: none; font-weight: bold;"> ${input.telefono_cliente} (WhatsApp) </a>` : 'No especificado'}
            </div> 
            <div class="field-label">URL de la Propiedad</div> 
            <div class="field-value">
              ${input.url_propiedad ? `<a href="${input.url_propiedad}" style="color: #3498db; text-decoration: none; word-break: break-all;">${input.url_propiedad}</a>` : 'No especificada'}
            </div> 
          </div> 
          <div class="footer"> Este es un aviso automático generado por el Agente IA de Fausti Propiedades. </div> 
        </div> 
      </body> </html>`;

    const subject = `⚠️ Solicita Asesoramiento - ${input.nombre_cliente} - ${input.motivo}`;
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;

    // Ejecutamos los envíos
    const sendPromises = recipients.map(async (to) => {
      console.log(`📧 Preparing email for: ${to}`);
      const messageParts = [
        `From: Nico Agent <me@gmail.com>`,
        `To: ${to}`,
        `Content-Type: text/html; charset=utf-8`,
        `MIME-Version: 1.0`,
        `Subject: ${utf8Subject}`,
        '',
        htmlBody,
      ];
      const message = messageParts.join('\n');
      const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      try {
        console.log(`🚀 Sending to: ${to}`);
        const res = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodedMessage },
        });
        console.log(`✅ Email sent to: ${to} - Status: ${res.status}`);
        return res;
      } catch (innerErr) {
        console.error(`❌ Error sending to ${to}:`, innerErr);
        throw innerErr;
      }
    });

    // IMPORTANTE: No usamos 'await' aquí si queremos que sea 100% asíncrono,
    // pero Mastra maneja las ejecuciones de tools de forma que si retornas el resultado rápido, el agente sigue.
    try {
        await Promise.all(sendPromises);
        console.log("🏁 All emails processed");
    } catch (err) {
        console.error("Error global enviando mails de venta:", err);

        throw new Error("Falló el envío del correo de venta. Revisa los logs.");
    }
    
    return { 
      status: 'success', 
      message: 'El equipo de ventas ha sido notificado y se pondrá en contacto pronto.' 
    };
  },
});
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

export const potentialSaleEmailTool = createTool({
  id: 'potential_sale_email',
  description: 'Úsala ÚNICAMENTE cuando el usuario confirme interés en comprar una propiedad y YA TENGAS su nombre. Envía un correo interno al equipo de ventas con los datos del lead y la propiedad',
  inputSchema: z.object({
    nombre_cliente: z.string().optional().describe("Nombre completo del interesado"),
    telefono_cliente: z.string().optional().describe("Número de teléfono de contacto"),
    email_cliente: z.string().optional().describe("Email si estuviera disponible"),
    direccion_propiedad: z.string().optional().describe("Dirección o título de la propiedad de interés"),
    url_propiedad: z.string().optional().describe("Link de la publicación (Zonaprop, etc)"),
  }),
  execute: async (inputData) => {
    console.log("🛠️ Tool Invoked: potential_sale_email");
    console.log("📥 Input recibido:", JSON.stringify(inputData, null, 2));

    const gmail = getGmail();
    console.log("🔧 Gmail client initialized");

    const recipients = ["c.vogzan@gmail.com", "faustiprop@gmail.com", "diego.barrueta@gmail.com"];
    
    const telLimpio = inputData.telefono_cliente?.replace(/[^0-9]/g, '');

    const htmlBody = `
      <!DOCTYPE html> <html> <head> <style> 
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } 
      .container { width: 100%; max-width: 600px; margin: 20px auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden; } 
      .header { background-color: #2c3e50; color: #ffffff; padding: 20px; text-align: center; } 
      .content { padding: 20px; } 
      .field-label { font-weight: bold; color: #7f8c8d; text-transform: uppercase; font-size: 12px; } 
      .field-value { margin-bottom: 15px; font-size: 16px; border-bottom: 1px solid #f9f9f9; padding-bottom: 5px; } 
      .footer { background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 12px; color: #95a5a6; } 
      .tag { background-color: #e67e22; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; } 
      </style> </head> 
      <body> 
        <div class="container"> 
          <div class="header"> <h2>⚠️ Nueva Potencial Venta</h2> <span class="tag">AVISO DE INTERÉS</span> </div> 
          <div class="content"> 
            <p>Hola, <strong>Nico</strong> ha detectado un cliente interesado en una propiedad de venta:</p> 
            <div class="field-label">Cliente</div> <div class="field-value">${inputData.nombre_cliente}</div> 
            <div class="field-label">Teléfono de contacto</div> 
            <div class="field-value"> <a href="https://wa.me/${telLimpio}" style="color: #27ae60; text-decoration: none; font-weight: bold;"> ${inputData.telefono_cliente} (WhatsApp) </a> </div> 
            <div class="field-label">Email</div> <div class="field-value">${inputData.email_cliente || 'No proporcionado'}</div> 
            <div class="field-label">Propiedad</div> <div class="field-value">${inputData.direccion_propiedad || "No especificada / URL"}</div> 
            <div style="margin-top: 25px; text-align: center;"> 
              <a href="${inputData.url_propiedad}" style="background-color: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;"> Ver Ficha de Propiedad </a> 
            </div> 
          </div> 
          <div class="footer"> Este es un aviso automático generado por el Agente IA de Fausti Propiedades. </div> 
        </div> 
      </body> </html>`;

    const subject = `⚠️ Nueva Potencial Venta - ${inputData.nombre_cliente}`;
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
      message: 'La notificación ha sido enviada a los responsables de la inmobiliaria.' 
    };
  },
});
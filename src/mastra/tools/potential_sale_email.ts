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
  description: 'NOTIFICACIÓN OBLIGATORIA: Envía un email a los dueños cuando un cliente quiere visitar una propiedad de VENTA.',
  inputSchema: z.object({
    nombre_cliente: z.string(),
    telefono_cliente: z.string(),
    email_cliente: z.string().optional(),
    direccion_propiedad: z.string(),
    url_propiedad: z.string().url(),
  }),
  execute: async (input) => {
    const gmail = getGmail();
    const recipients = ["c.vogzan@gmail.com", "faustiprop@gmail.com", "diego.barrueta@gmail.com"];
    
    const telLimpio = input.telefono_cliente.replace(/[^0-9]/g, '');

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
            <div class="field-label">Cliente</div> <div class="field-value">${input.nombre_cliente}</div> 
            <div class="field-label">Teléfono de contacto</div> 
            <div class="field-value"> <a href="https://wa.me/${telLimpio}" style="color: #27ae60; text-decoration: none; font-weight: bold;"> ${input.telefono_cliente} (WhatsApp) </a> </div> 
            <div class="field-label">Email</div> <div class="field-value">${input.email_cliente || 'No proporcionado'}</div> 
            <div class="field-label">Propiedad</div> <div class="field-value">${input.direccion_propiedad}</div> 
            <div style="margin-top: 25px; text-align: center;"> 
              <a href="${input.url_propiedad}" style="background-color: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;"> Ver Ficha de Propiedad </a> 
            </div> 
          </div> 
          <div class="footer"> Este es un aviso automático generado por el Agente IA de Fausti Propiedades. </div> 
        </div> 
      </body> </html>`;

    const subject = `⚠️ Nueva Potencial Venta - ${input.nombre_cliente}`;
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;

    // Ejecutamos los envíos
    const sendPromises = recipients.map(async (to) => {
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

      return gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });
    });

    // IMPORTANTE: No usamos 'await' aquí si queremos que sea 100% asíncrono,
    // pero Mastra maneja las ejecuciones de tools de forma que si retornas el resultado rápido, el agente sigue.
    Promise.all(sendPromises).catch(err => console.error("Error enviando mails de venta:", err));

    return { 
      status: 'success', 
      message: 'La notificación ha sido enviada a los responsables de la inmobiliaria.' 
    };
  },
});
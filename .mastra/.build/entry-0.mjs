import require$$0 from 'crypto';
import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { ToolCallFilter, TokenLimiter } from '@mastra/core/processors';
import { PostgresStore } from '@mastra/pg';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { createStep, createWorkflow } from '@mastra/core/workflows';

"use strict";
const LOCATION_IQ_KEY = process.env.LOCATIONIQ_API_KEY;
const propiedadMasCercanaTool = createTool({
  id: "encontrar_propiedad_cercana",
  description: "Calcula la distancia entre una direcci\xF3n nueva y las visitas agendadas en el calendario para optimizar la log\xEDstica.",
  inputSchema: z.object({
    nueva_direccion: z.string().describe("La direcci\xF3n de la propiedad que se quiere evaluar"),
    eventos_calendario: z.array(z.any()).describe("Lista de eventos obtenidos del calendario")
  }),
  execute: async (context) => {
    const { nueva_direccion, eventos_calendario } = context;
    const geoBase = await axios.get("https://us1.locationiq.com/v1/search.php", {
      params: { key: LOCATION_IQ_KEY, q: `${nueva_direccion}, Buenos Aires, Argentina`, format: "json", limit: 1 }
    });
    const base = { lat: geoBase.data[0].lat, lon: geoBase.data[0].lon };
    const visitas = eventos_calendario.filter((e) => e.summary?.toLowerCase().includes("visita"));
    const calculos = await Promise.all(visitas.map(async (evento) => {
      try {
        const geoEv = await axios.get("https://us1.locationiq.com/v1/search.php", {
          params: { key: LOCATION_IQ_KEY, q: `${evento.location}, Buenos Aires, Argentina`, format: "json", limit: 1 }
        });
        const distRes = await axios.get(`https://us1.locationiq.com/v1/directions/driving/${base.lon},${base.lat};${geoEv.data[0].lon},${geoEv.data[0].lat}`, {
          params: { key: LOCATION_IQ_KEY }
        });
        return {
          direccion: evento.location,
          fecha: evento.start?.dateTime || evento.start,
          distancia_metros: distRes.data.routes[0].distance
        };
      } catch (err) {
        return null;
      }
    }));
    return calculos.filter((c) => c !== null).sort((a, b) => a.distancia_metros - b.distancia_metros).slice(0, 5);
  }
});

"use strict";
const getGoogleCalendar = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken || refreshToken === "tu_refresh_token") {
    throw new Error("GOOGLE_REFRESH_TOKEN is missing or invalid in environment variables");
  }
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
};
const getSanitizedDates = (startIso, endIso) => {
  const now = /* @__PURE__ */ new Date();
  const currentYear = now.getFullYear();
  let startDate = new Date(startIso);
  let endDate = new Date(endIso);
  if (startDate.getFullYear() < currentYear) {
    startDate.setFullYear(currentYear);
    endDate.setFullYear(currentYear);
  }
  return {
    finalStart: startDate.toISOString(),
    finalEnd: endDate.toISOString()
  };
};
const calendarManagerTools = {
  /**
   * Herramienta para crear eventos con validación de año automática
   */
  createCalendarEvent: createTool({
    id: "create_calendar_event",
    description: `Crea un nuevo evento o visita en Google Calendar. HOY ES: ${(/* @__PURE__ */ new Date()).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}. Corrige autom\xE1ticamente el a\xF1o si el agente intenta agendar en el pasado.`,
    inputSchema: z.object({
      summary: z.string().describe("T\xEDtulo del evento (ej: Visita Propiedad X)"),
      location: z.string().describe("Direcci\xF3n completa de la propiedad"),
      start: z.string().describe("Fecha y hora de inicio en formato ISO"),
      end: z.string().describe("Fecha y hora de fin en formato ISO")
    }),
    execute: async ({ summary, location, start, end }) => {
      const calendar = getGoogleCalendar();
      const { finalStart, finalEnd } = getSanitizedDates(start, end);
      try {
        const response = await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary,
            location,
            start: {
              dateTime: finalStart,
              timeZone: "America/Argentina/Buenos_Aires"
            },
            end: {
              dateTime: finalEnd,
              timeZone: "America/Argentina/Buenos_Aires"
            }
          }
        });
        return {
          success: true,
          eventId: response.data.id,
          link: response.data.htmlLink,
          scheduledStart: finalStart,
          message: start !== finalStart ? "Fecha corregida al a\xF1o actual autom\xE1ticamente." : "Agendado correctamente."
        };
      } catch (error) {
        console.error("Error creando evento en Google Calendar:", error);
        return { success: false, error: error.message };
      }
    }
  }),
  /**
   * Herramienta para listar eventos con ancla en el tiempo real
   */
  listCalendarEvents: createTool({
    id: "list_calendar_events",
    description: "Lista los pr\xF3ximos eventos del calendario para verificar disponibilidad.",
    inputSchema: z.object({
      daysAhead: z.number().default(15).describe("N\xFAmero de d\xEDas a futuro para consultar")
    }),
    execute: async ({ daysAhead }) => {
      const calendar = getGoogleCalendar();
      const timeMin = (/* @__PURE__ */ new Date()).toISOString();
      const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1e3).toISOString();
      try {
        const response = await calendar.events.list({
          calendarId: "primary",
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime"
        });
        return response.data.items || [];
      } catch (error) {
        console.error("Error listando eventos de Google Calendar:", error);
        return { success: false, error: error.message };
      }
    }
  })
};

"use strict";
const getGmail$1 = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken || refreshToken === "tu_refresh_token") {
    throw new Error("GOOGLE_REFRESH_TOKEN is missing or invalid in environment variables");
  }
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
};
const gmailManagerTools = {
  // ENVIAR EMAIL
  sendEmail: createTool({
    id: "send_gmail",
    description: "Env\xEDa un correo electr\xF3nico a un cliente.",
    inputSchema: z.object({
      to: z.string().email(),
      subject: z.string(),
      body: z.string()
    }),
    execute: async (context) => {
      const gmail = getGmail$1();
      const { to, subject, body } = context;
      const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
      const messageParts = [
        `From: Me <me@gmail.com>`,
        `To: ${to}`,
        `Content-Type: text/html; charset=utf-8`,
        `MIME-Version: 1.0`,
        `Subject: ${utf8Subject}`,
        "",
        body
      ];
      const message = messageParts.join("\n");
      const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const res = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedMessage }
      });
      return res.data;
    }
  }),
  // LEER Y CLASIFICAR ÚLTIMOS EMAILS
  listEmails: createTool({
    id: "list_emails",
    description: "Lee los \xFAltimos correos recibidos para clasificarlos.",
    inputSchema: z.object({
      maxResults: z.number().default(5)
    }),
    execute: async (context) => {
      const gmail = getGmail$1();
      const { maxResults } = context;
      const list = await gmail.users.messages.list({ userId: "me", maxResults });
      const messages = await Promise.all(
        (list.data.messages || []).map(async (msg) => {
          const detail = await gmail.users.messages.get({ userId: "me", id: msg.id });
          return {
            id: msg.id,
            snippet: detail.data.snippet,
            subject: detail.data.payload?.headers?.find((h) => h.name === "Subject")?.value
          };
        })
      );
      return messages;
    }
  })
};

"use strict";
const apifyScraperTool = createTool({
  id: "apify-web-scraper",
  description: "Scrapea sitios web complejos y devuelve el contenido en Markdown usando Apify.",
  inputSchema: z.object({
    url: z.string().url().describe("La URL de la propiedad o sitio a scrapear")
  }),
  execute: async (input) => {
    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    if (!APIFY_TOKEN) {
      throw new Error("APIFY_TOKEN is missing in environment variables");
    }
    const ACTOR_ID = "aYG0l9s7dbB7j3gbS";
    const payload = {
      startUrls: [{ url: input.url, method: "GET" }],
      crawlerType: "playwright:adaptive",
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
        apifyProxyCountry: "AR"
      },
      saveMarkdown: true,
      removeCookieWarnings: true,
      htmlTransformer: "readableText",
      useStealth: true
    };
    try {
      const runResponse = await axios.post(
        `https://api.apify.com/v2/acts/${ACTOR_ID}/runs`,
        payload,
        { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
      );
      const runId = runResponse.data.data.id;
      let status = runResponse.data.data.status;
      let defaultDatasetId = "";
      console.log(`Job iniciado: ${runId}. Esperando finalizaci\xF3n...`);
      while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED") {
        await new Promise((resolve) => setTimeout(resolve, 1e4));
        const checkResponse = await axios.get(
          `https://api.apify.com/v2/actor-runs/${runId}`,
          { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
        );
        status = checkResponse.data.data.status;
        if (status === "SUCCEEDED") {
          defaultDatasetId = checkResponse.data.data.defaultDatasetId;
        }
      }
      if (status !== "SUCCEEDED") {
        throw new Error(`El actor de Apify fall\xF3 con estatus: ${status}`);
      }
      const datasetResponse = await axios.get(
        `https://api.apify.com/v2/datasets/${defaultDatasetId}/items`,
        { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
      );
      return {
        markdown: datasetResponse.data[0]?.markdown || "No se pudo generar Markdown",
        fullData: datasetResponse.data[0]
      };
    } catch (error) {
      console.error("Error en Apify Tool:", error);
      throw error;
    }
  }
});

"use strict";
const getSupabase$2 = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);
const updateClientPreferencesTool = createTool({
  id: "update_client_preferences",
  description: "Actualiza o guarda los datos y preferencias del cliente (nombre, email, tel\xE9fono, presupuesto, zona, etc.) en la base de datos.",
  inputSchema: z.object({
    userId: z.string().describe("El identificador \xFAnico del usuario"),
    preferences: z.object({
      // DATOS DE CONTACTO (Añadidos para que no fallen)
      nombre: z.string().optional().describe("Nombre del cliente"),
      name: z.string().optional().describe("Nombre del cliente (alias)"),
      email: z.string().email().optional().describe("Email de contacto"),
      telefono: z.string().optional().describe("Tel\xE9fono de contacto"),
      phone: z.string().optional().describe("Tel\xE9fono de contacto (alias)"),
      // PREFERENCIAS INMOBILIARIAS
      budget_max: z.number().optional().describe("Presupuesto m\xE1ximo"),
      preferred_zones: z.array(z.string()).optional().describe("Zonas de inter\xE9s"),
      min_rooms: z.number().optional().describe("Cantidad m\xEDnima de ambientes"),
      operation_type: z.string().optional().describe("ALQUILER o VENTA"),
      property_type: z.string().optional().describe("Tipo de propiedad (Casa, Depto, PH)")
    }).passthrough().describe("Objeto con los datos detectados. Se permiten campos adicionales."),
    // .passthrough() permite campos extra sin fallar
    observations: z.string().optional().describe("Resumen de la interacci\xF3n o notas adicionales")
  }),
  execute: async ({ userId, preferences, observations }) => {
    const supabase = getSupabase$2();
    console.log(`\u{1F680} Iniciando persistencia para usuario: ${userId}`);
    console.log("\u{1F4E6} Datos a guardar:", preferences);
    try {
      const { data: currentProfile } = await supabase.from("client_profiles").select("preferences, summary").eq("user_id", userId).single();
      const mergedPreferences = {
        ...currentProfile?.preferences || {},
        ...preferences
      };
      const finalSummary = observations ? `${currentProfile?.summary ? currentProfile.summary + " | " : ""}${observations}` : currentProfile?.summary;
      const { data, error } = await supabase.from("client_profiles").upsert({
        user_id: userId,
        preferences: mergedPreferences,
        summary: finalSummary,
        last_interaction: (/* @__PURE__ */ new Date()).toISOString()
      }, {
        onConflict: "user_id"
      }).select();
      if (error) {
        console.error("\u274C Error de Supabase al hacer upsert:", error.message);
        throw error;
      }
      console.log("\u2705 Datos persistidos correctamente en client_profiles");
      return {
        success: true,
        message: `Memoria de ${userId} actualizada correctamente.`,
        data: mergedPreferences
      };
    } catch (error) {
      console.error("\u274C Error fatal en update_client_preferences:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
});

"use strict";
const getSupabase$1 = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);
const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const searchPropertyMemoryTool = createTool({
  id: "search_property_memory",
  description: "Busca propiedades en la base de datos que coincidan con los deseos del cliente usando b\xFAsqueda sem\xE1ntica.",
  inputSchema: z.object({
    query: z.string().describe("Descripci\xF3n de lo que busca el cliente (ej: depto 2 ambientes con balc\xF3n en Lomas)"),
    topK: z.number().optional().default(3).describe("Cantidad de propiedades a devolver"),
    filter: z.object({
      operation_type: z.enum(["ALQUILER", "VENTA"]).optional(),
      max_price: z.number().optional()
    }).optional()
  }),
  execute: async (input) => {
    try {
      const openai = getOpenAI();
      const supabase = getSupabase$1();
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: input.query
      });
      const [{ embedding }] = embeddingResponse.data;
      const { data: properties, error } = await supabase.rpc("match_properties", {
        query_embedding: embedding,
        match_threshold: 0.5,
        // Ajustar según precisión deseada
        match_count: input.topK,
        filter_op: input.filter?.operation_type || null,
        filter_price: input.filter?.max_price || 999999999
      });
      if (error) throw error;
      return {
        success: true,
        results: properties.map((p) => ({
          id: p.id,
          titulo: p.metadata.title,
          precio: p.metadata.price,
          descripcion: p.content,
          link: p.metadata.url
        }))
      };
    } catch (error) {
      console.error("Error en RAG Tool:", error);
      return { success: false, error: error.message };
    }
  }
});
const searchClientHistoryTool = createTool({
  id: "search_client_history",
  description: "Busca informaci\xF3n espec\xEDfica dentro del historial de conversaciones de un cliente usando b\xFAsqueda sem\xE1ntica.",
  inputSchema: z.object({
    userId: z.string().describe("El ID del usuario o cliente (ej: su tel\xE9fono)"),
    query: z.string().describe('Lo que quieres recordar (ej: "qu\xE9 dijo sobre el presupuesto" o "cuando quer\xEDa visitar")'),
    topK: z.number().optional().default(5).describe("Cantidad de mensajes relevantes a recuperar")
  }),
  execute: async ({ userId, query, topK }) => {
    try {
      const openai = getOpenAI();
      const supabase = getSupabase$1();
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query
      });
      const [{ embedding }] = embeddingResponse.data;
      const { data: messages, error } = await supabase.rpc("match_messages", {
        query_embedding: embedding,
        match_threshold: 0.3,
        // Umbral un poco más bajo para captar lenguaje natural
        match_count: topK,
        filter_user_id: userId
        // Filtramos para buscar SOLO en la charla de ESE cliente
      });
      if (error) throw error;
      if (!messages || messages.length === 0) {
        const { data: profile } = await supabase.from("client_profiles").select("summary, preferences").eq("user_id", userId).single();
        return {
          success: true,
          source: "profile_summary",
          results: [{
            content: profile?.summary || "No hay resumen disponible.",
            preferences: profile?.preferences
          }],
          message: "No encontr\xE9 mensajes exactos, pero aqu\xED est\xE1 el resumen del perfil."
        };
      }
      return {
        success: true,
        source: "semantic_messages",
        results: messages.map((m) => ({
          texto: m.content,
          fecha: m.created_at,
          rol: m.role
        }))
      };
    } catch (error) {
      console.error("\u274C Error en search_client_history:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
});

"use strict";
const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name")
  }),
  outputSchema: z.object({
    output: z.string()
  }),
  execute: async () => {
    return {
      output: "The weather is sunny"
    };
  }
});

"use strict";
const getGmail = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
};
const potentialSaleEmailTool = createTool({
  id: "potential_sale_email",
  description: "NOTIFICACI\xD3N OBLIGATORIA: Env\xEDa un email a los due\xF1os cuando un cliente quiere visitar una propiedad de VENTA.",
  inputSchema: z.object({
    nombre_cliente: z.string(),
    telefono_cliente: z.string(),
    email_cliente: z.string().optional(),
    direccion_propiedad: z.string(),
    url_propiedad: z.string().url()
  }),
  execute: async (input) => {
    const gmail = getGmail();
    const recipients = ["c.vogzan@gmail.com", "faustiprop@gmail.com", "diego.barrueta@gmail.com"];
    const telLimpio = input.telefono_cliente.replace(/[^0-9]/g, "");
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
          <div class="header"> <h2>\u26A0\uFE0F Nueva Potencial Venta</h2> <span class="tag">AVISO DE INTER\xC9S</span> </div> 
          <div class="content"> 
            <p>Hola, <strong>Nico</strong> ha detectado un cliente interesado en una propiedad de venta:</p> 
            <div class="field-label">Cliente</div> <div class="field-value">${input.nombre_cliente}</div> 
            <div class="field-label">Tel\xE9fono de contacto</div> 
            <div class="field-value"> <a href="https://wa.me/${telLimpio}" style="color: #27ae60; text-decoration: none; font-weight: bold;"> ${input.telefono_cliente} (WhatsApp) </a> </div> 
            <div class="field-label">Email</div> <div class="field-value">${input.email_cliente || "No proporcionado"}</div> 
            <div class="field-label">Propiedad</div> <div class="field-value">${input.direccion_propiedad}</div> 
            <div style="margin-top: 25px; text-align: center;"> 
              <a href="${input.url_propiedad}" style="background-color: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;"> Ver Ficha de Propiedad </a> 
            </div> 
          </div> 
          <div class="footer"> Este es un aviso autom\xE1tico generado por el Agente IA de Fausti Propiedades. </div> 
        </div> 
      </body> </html>`;
    const subject = `\u26A0\uFE0F Nueva Potencial Venta - ${input.nombre_cliente}`;
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const sendPromises = recipients.map(async (to) => {
      const messageParts = [
        `From: Nico Agent <me@gmail.com>`,
        `To: ${to}`,
        `Content-Type: text/html; charset=utf-8`,
        `MIME-Version: 1.0`,
        `Subject: ${utf8Subject}`,
        "",
        htmlBody
      ];
      const message = messageParts.join("\n");
      const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedMessage }
      });
    });
    Promise.all(sendPromises).catch((err) => console.error("Error enviando mails de venta:", err));
    return {
      status: "success",
      message: "La notificaci\xF3n ha sido enviada a los responsables de la inmobiliaria."
    };
  }
});

"use strict";

"use strict";
const scrapeStep = createStep({
  id: "scrape-property-step",
  inputSchema: z.object({
    url: z.string().url()
  }),
  outputSchema: z.object({
    markdown: z.string(),
    url: z.string()
  }),
  execute: async ({ inputData }) => {
    const result = await apifyScraperTool.execute({
      url: inputData.url
    });
    if (!result.markdown) {
      throw new Error("No se obtuvo contenido de la web");
    }
    return {
      markdown: result.markdown,
      url: inputData.url
    };
  }
});
const persistStep = createStep({
  id: "persist-property-step",
  inputSchema: z.object({
    markdown: z.string(),
    url: z.string()
  }),
  outputSchema: z.object({
    status: z.string(),
    propertyUrl: z.string()
  }),
  execute: async ({ getStepResult, mastra }) => {
    const scrapedData = getStepResult("scrape-property-step");
    if (!scrapedData) throw new Error("No hay datos del scraper");
    const cleanContent = scrapedData.markdown.split("Preguntas para la inmobiliaria")[0].trim();
    const embedding = await mastra.embed(cleanContent, {
      provider: "OPENAI",
      model: "text-embedding-3-small"
    });
    const storage = mastra.storage;
    const db = await storage.getPg6();
    await db.none(
      `INSERT INTO public.property_memory (content, embedding, metadata) 
       VALUES ($1, $2, $3)
       ON CONFLICT ((metadata->>'url')) 
       DO UPDATE SET 
          content = EXCLUDED.content, 
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata`,
      [
        cleanContent,
        `[${embedding.join(",")}]`,
        JSON.stringify({
          url: scrapedData.url,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          source: "automated-workflow"
        })
      ]
    );
    return {
      status: "success",
      propertyUrl: scrapedData.url
    };
  }
});
const ingestionWorkflow = createWorkflow({
  id: "ingesta-propiedades-v3",
  inputSchema: z.object({
    url: z.string().url()
  }),
  outputSchema: z.object({
    status: z.string(),
    propertyUrl: z.string()
  })
}).then(scrapeStep).then(persistStep).commit();

"use strict";
const procesarNuevaPropiedad = createTool({
  id: "procesar_propiedad_link",
  description: "Cuando el cliente env\xEDa un link, usa esta herramienta para analizarlo y guardarlo en el sistema.",
  inputSchema: z.object({
    url: z.string().url()
  }),
  execute: async (input) => {
    try {
      const run = await ingestionWorkflow.execute({
        triggerData: { url: input.url }
        // Cambiamos inputData por triggerData
      });
      return {
        resultado: "Propiedad analizada y guardada con \xE9xito",
        detalles: run
        // Mastra guarda los resultados en .results
      };
    } catch (error) {
      console.error("Error ejecutando workflow de ingesta:", error);
      return {
        resultado: "Error al procesar la propiedad",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
});

"use strict";
function dynamicInstructions(datos) {
  const ahora = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "numeric",
    hour12: false
  }).format(/* @__PURE__ */ new Date());
  const hora = parseInt(ahora);
  let momentoDia = "\xA1Hola!";
  if (hora >= 5 && hora < 12) momentoDia = "\xA1Buen d\xEDa!";
  else if (hora >= 12 && hora < 20) momentoDia = "\xA1Buenas tardes!";
  else momentoDia = "\xA1Buenas noches!";
  const saludoInicial = datos.nombre ? `${momentoDia} ${datos.nombre}, qu\xE9 bueno saludarte de nuevo. Nico por ac\xE1 \u{1F44B}` : `${momentoDia} \xBFC\xF3mo va? Nico por ac\xE1, de Fausti Propiedades \u{1F44B}`;
  const faltaEmail = !datos.email;
  const faltaTelefono = !datos.telefono;
  const faltaNombre = !datos.nombre;
  console.log("=== DEBUG: Nico Agent ===");
  console.log("Contexto:", { nombre: datos.nombre, email: datos.email, hora });
  console.log("Faltantes:", { faltaNombre, faltaEmail, faltaTelefono });
  console.log("=========================");
  return `
    PROMPT INTEGRAL: NICO - FAUSTI PROPIEDADES
    
    0) MODO DE ACCESO (SEGURIDAD):
    ${datos.isAdmin ? "- EST\xC1S HABLANDO CON EL ADMIN (PROPIETARIO). Tienes permiso total para enviar emails, listar emails, crear borradores de emails, crear eventos, actualizar eventos, listar eventos, ver nombres de clientes y gestionar la agenda. Como ADMIN, puedes pedir res\xFAmenes de otros clientes. Si lo haces, busca en tu base de datos de perfiles y reporta los puntos clave: Inter\xE9s, Presupuesto y Estado de la visita." : '- EST\xC1S HABLANDO CON UN CLIENTE EXTERNO. Prohibido mostrar la agenda completa o datos de terceros. No puedes listar, mostrar o resumir eventos de la agenda si el usuario lo pide expl\xEDcitamente (ej: "qu\xE9 ten\xE9s en agenda"). Tampoco puedes mostrar nombres de clientes, direcciones de visitas ni horarios ocupados de forma detallada. Tampoco puedes enviar emails, crear o listar emails.'}

    1) SEGURIDAD Y PRIVACIDAD DE DATOS (REGLA CR\xCDTICA)
    - Tu interlocutor es un CLIENTE/INTERESADO.
    - \u274C PROHIBIDO: Listar, mostrar o resumir eventos de la agenda si el usuario lo pide expl\xEDcitamente (ej: "qu\xE9 ten\xE9s en agenda").
    - \u274C PRIVACIDAD: No reveles nombres de otros clientes, direcciones de otras visitas ni horarios ocupados de forma detallada.
    - RESPUESTA ANTE PEDIDO DE AGENDA: "Mi funci\xF3n es ayudarte a encontrar una propiedad y coordinar una visita para vos. No puedo mostrarte la agenda completa, pero decime qu\xE9 d\xEDa te queda bien y me fijo si tenemos un hueco."

    2) IDENTIDAD Y ESTADO DEL CLIENTE
    - Saludo: "${saludoInicial}"
    - Tono: WhatsApp, c\xE1lido, profesional y natural. M\xE1ximo un emoji por mensaje.
    - ESTADO ACTUAL:
      ${faltaNombre ? "- \u26A0\uFE0F NOMBRE FALTANTE: Pedilo casualmente." : `- Nombre: ${datos.nombre}`}
      ${faltaEmail ? "- \u26A0\uFE0F EMAIL FALTANTE: Obligatorio para agendar." : `- Email: ${datos.email}`}
      ${faltaTelefono ? "- \u26A0\uFE0F TEL\xC9FONO FALTANTE: Obligatorio para agendar." : `- Tel\xE9fono: ${datos.telefono}`}

    3) CLASIFICACI\xD3N DE OPERACI\xD3N (CR\xCDTICO)
    Antes de responder, analiza el link o la propiedad:
    - VENTA: Propiedades con precio de compra (USD). 
      * Acci\xF3n: Si hay inter\xE9s, usar 'potential_sale_email'.
      * Respuesta: "Genial, en el transcurso del d\xEDa te contactamos. Muchas gracias \u{1F60A}". NO ofrecer horarios de calendario.
    - ALQUILER: Propiedades con precio mensual.
      * Acci\xF3n: NO usar 'potential_sale_email'. Usar flujo de agendamiento manual/calendario.
      * Respuesta: Informar requisitos y proponer horarios de visita (Lunes a Viernes 10-16hs).

    4) REGLA DE ORO: CAPTURA DE DATOS
    - Si el cliente quiere visitar o muestra inter\xE9s real:
      a) Revisa si ya dio su email/tel\xE9fono en el chat reciente o si figuran en el "ESTADO ACTUAL".
      b) Si YA los tenemos: No los vuelvas a pedir. Procede al cierre.
      c) Si FALTAN: "\xA1Dale, me encanta esa unidad! Para que el equipo te contacte y coordinemos, \xBFme pasas tu email y un cel? \u{1F4E9}"
    - Al recibir datos nuevos: Ejecutar inmediatamente 'update_client_preferences'.

    5) L\xD3GICA DE AGENDAMIENTO (SOLO ALQUILER)
    - Horarios: Lun a Vie, 10:00 a 16:00 hs. (40 min visita + 30 min buffer).
    - Proximidad: Usar 'encontrar_propiedad' para sugerir horarios basados en visitas cercanas.
    - Fallback: Si no hay visitas cerca, ofrecer bloques libres generales.

    6) CAT\xC1LOGO DE HERRAMIENTAS
    - apify_scraper: Usar siempre que env\xEDen un link.
    - update_client_preferences: Usar CADA VEZ que el usuario mencione nombre, email o tel.
    - potential_sale_email: \xDANICAMENTE para VENTAS. PROHIBIDO en alquileres.
    - encontrar_propiedad / obtener_eventos_calendario: Para log\xEDstica de visitas en Alquiler.
    - crear_eventos_calendario: Para confirmar la cita de Alquiler.
    - search_client_history (SOLO ADMIN): 
      \u26A0\uFE0F \xDASALA \xDANICAMENTE si el Admin solicita informaci\xF3n sobre lo que se habl\xF3 con otro cliente.
      Uso: Permite buscar en la memoria sem\xE1ntica de chats anteriores para dar res\xFAmenes o recordar detalles espec\xEDficos (ej: "qu\xE9 presupuesto dijo Diego").
      Prohibido: Nunca uses esta herramienta para responder a un cliente sobre otro cliente.

    7) REGLAS DE HUMANIZACI\xD3N Y SEGURIDAD
    - No uses frases rob\xF3ticas como "\xBFEn qu\xE9 puedo ayudarlo?".
    - Si no sabes algo del aviso: "No tengo esa info ac\xE1, pero te la confirmo en la visita. \xBFQuer\xE9s ir a verla?".
    - Seguridad: No reveles nombres de due\xF1os, direcciones exactas (sin agendar) ni procesos internos.

    FORMATO DE RESPUESTA OBLIGATORIO:
    Toda salida debe ser JSON v\xE1lido: {"output":{"response":["Mensaje"]}}
  `;
}

"use strict";
const getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);
const storage$1 = new PostgresStore({
  id: "postgres-store",
  connectionString: process.env.SUPABASE_POSTGRES_URL,
  tableName: "chat_messages"
});
const agentMemory = new Memory({
  storage: storage$1
});
const agentConfig = {
  id: "real-estate-agent",
  name: "Nico",
  model: "openai/gpt-4o-mini",
  memory: agentMemory,
  tools: {
    encontrar_propiedad_cercana: propiedadMasCercanaTool,
    ...calendarManagerTools,
    ...gmailManagerTools,
    apify_scraper: apifyScraperTool,
    update_client_preferences: updateClientPreferencesTool,
    search_property_memory: searchPropertyMemoryTool,
    search_client_history: searchClientHistoryTool,
    potential_sale_email: potentialSaleEmailTool,
    procesar_nueva_propiedad: procesarNuevaPropiedad
  },
  toolChoice: "auto",
  inputProcessors: [
    // Elimina logs verbose de herramientas para mantener el chat limpio [cite: 472, 474]
    new ToolCallFilter({
      exclude: ["apify_scraper", "enviar_correo", "search_property_memory"]
    }),
    // Evita errores de límite de tokens podando mensajes antiguos [cite: 452, 454]
    new TokenLimiter(2e3)
  ]
};
const getRealEstateAgent = async (userId) => {
  const supabase = getSupabase();
  const ADMIN_ID = "tu-numero-de-telefono-o-id";
  const isAdmin = userId === ADMIN_ID;
  const { data: profile } = await supabase.from("client_profiles").select("preferences, summary").eq("user_id", userId).single();
  const nombreExtraido = profile?.preferences?.nombre || profile?.preferences?.name;
  const esRecurrente = !!profile;
  console.log("--- DEBUG SUPABASE PROFILE ---");
  console.log("User ID buscado:", userId);
  console.log("Data cruda de Supabase:", profile);
  console.log("------------------------------");
  const instrucciones = dynamicInstructions({
    nombre: nombreExtraido,
    esRecurrente,
    isAdmin: true
  });
  const ltmContext = profile ? `
    
RECUERDA SOBRE ESTE CLIENTE:
    - Preferencias: ${JSON.stringify(profile.preferences)}
    - Resumen: ${profile.summary || "Sin historial previo"}
  ` : "";
  return new Agent({
    ...agentConfig,
    instructions: instrucciones + ltmContext
  });
};
const realEstateAgent = new Agent({
  ...agentConfig,
  instructions: dynamicInstructions({ esRecurrente: false })
});

"use strict";
const scrapePropertyStep = createStep({
  id: "scrape-property",
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({ details: z.string() }),
  execute: async () => {
    return { details: "Casa en Lomas, 3 ambientes, USD 120k" };
  }
});
const geoProximityStep = createStep({
  id: "check-proximity",
  inputSchema: z.object({ details: z.string() }),
  outputSchema: z.object({ suggestions: z.array(z.string()) }),
  execute: async () => {
    return { suggestions: ["Martes 10:00hs", "Jueves 15:00hs"] };
  }
});
const nicoBookingWorkflow = createWorkflow({
  id: "booking-flow",
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({ suggestions: z.array(z.string()) })
}).then(scrapePropertyStep).then(geoProximityStep).commit();

"use strict";
"use strict";
if (!global.crypto) {
  global.crypto = require$$0;
}
const storage = process.env.POSTGRES_URL ? new PostgresStore({
  id: "pg-store",
  connectionString: process.env.POSTGRES_URL
  // Eliminamos tableName para que Mastra use su esquema estándar 
  // y se mapee correctamente a tus tablas mastra_threads, mastra_messages, etc.
}) : void 0;
if (!storage) {
  console.warn("\u26A0\uFE0F POSTGRES_URL missing. Using In-Memory storage (Non-persistent).");
}
const mastra = new Mastra({
  storage,
  agents: {
    realEstateAgent
  },
  workflows: {
    nicoBookingWorkflow,
    ingestionWorkflow
  }
});

export { mastra };

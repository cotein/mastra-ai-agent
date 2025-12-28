import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';

const getGmail = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken || refreshToken === 'tu_refresh_token') {
    throw new Error('GOOGLE_REFRESH_TOKEN is missing or invalid in environment variables');
  }
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
};

export const gmailManagerTools = {
  // ENVIAR EMAIL
  sendEmail: createTool({
    id: 'send_gmail',
    description: 'Envía un correo electrónico a un cliente.',
    inputSchema: z.object({
      to: z.string().email(),
      subject: z.string(),
      body: z.string(),
    }),
    execute: async (context) => {
      const gmail = getGmail();
      const { to, subject, body } = context;
      const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
      const messageParts = [
        `From: Me <me@gmail.com>`,
        `To: ${to}`,
        `Content-Type: text/html; charset=utf-8`,
        `MIME-Version: 1.0`,
        `Subject: ${utf8Subject}`,
        '',
        body,
      ];
      const message = messageParts.join('\n');
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });
      return res.data;
    },
  }),

  // LEER Y CLASIFICAR ÚLTIMOS EMAILS
  listEmails: createTool({
    id: 'list_emails',
    description: 'Lee los últimos correos recibidos para clasificarlos.',
    inputSchema: z.object({
      maxResults: z.number().default(5),
    }),
    execute: async (context) => {
      const gmail = getGmail();
      const { maxResults } = context;
      const list = await gmail.users.messages.list({ userId: 'me', maxResults });
      const messages = await Promise.all(
        (list.data.messages || []).map(async (msg) => {
          const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
          return {
            id: msg.id,
            snippet: detail.data.snippet,
            subject: detail.data.payload?.headers?.find(h => h.name === 'Subject')?.value,
          };
        })
      );
      return messages;
    },
  }),
};
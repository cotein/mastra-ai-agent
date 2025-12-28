import { r as require_token_util } from './chunk-DW3WE4M4.mjs';
import { _ as __commonJS, r as require_token_error } from './index.mjs';
import '@mastra/core/evals/scoreTraces';
import 'crypto';
import '@mastra/core';
import '@mastra/core/agent';
import '@mastra/memory';
import '@mastra/core/processors';
import '@mastra/pg';
import './tools/be3cdcbd-d185-4ca4-929f-ba96c100f3ad.mjs';
import '@mastra/core/tools';
import 'zod';
import 'axios';
import './tools/0d1c3662-d636-4868-b8b9-851057c50637.mjs';
import 'googleapis';
import './tools/a637a309-2b8b-473e-9b56-6f5587fac139.mjs';
import './tools/eac9f7b9-e8a5-4004-b1fe-7768fe6b9fb2.mjs';
import './tools/e75ed996-458d-43b1-962b-44e47e087fd5.mjs';
import '@supabase/supabase-js';
import './tools/b6338c9a-3ed8-4955-ae4b-5f0d7f9c2eb2.mjs';
import 'openai';
import './procesa-nueva-propiedad.mjs';
import '@mastra/core/workflows';
import './tools/f205419c-ad37-44c0-9217-b964722c83a3.mjs';
import 'fs/promises';
import 'https';
import 'path/posix';
import 'http';
import 'http2';
import 'stream';
import 'fs';
import 'path';
import '@mastra/core/utils/zod-to-json';
import '@mastra/core/error';
import '@mastra/core/utils';
import '@mastra/core/a2a';
import 'stream/web';
import 'zod/v4';
import 'zod/v3';
import '@mastra/core/memory';
import 'child_process';
import 'module';
import 'util';
import '@mastra/core/llm';
import 'os';
import '@mastra/core/request-context';
import '@mastra/core/server';
import 'buffer';
import './tools.mjs';

// ../memory/dist/token-6GSAFR2W-KVDFAJ2M.js
var require_token = __commonJS({
  "../../../node_modules/.pnpm/@vercel+oidc@3.0.5/node_modules/@vercel/oidc/dist/token.js"(exports, module) {
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
    var token_exports = {};
    __export(token_exports, {
      refreshToken: () => refreshToken
    });
    module.exports = __toCommonJS(token_exports);
    var import_token_error = require_token_error();
    var import_token_util = require_token_util();
    async function refreshToken() {
      const { projectId, teamId } = (0, import_token_util.findProjectInfo)();
      let maybeToken = (0, import_token_util.loadToken)(projectId);
      if (!maybeToken || (0, import_token_util.isExpired)((0, import_token_util.getTokenPayload)(maybeToken.token))) {
        const authToken = (0, import_token_util.getVercelCliToken)();
        if (!authToken) {
          throw new import_token_error.VercelOidcTokenError(
            "Failed to refresh OIDC token: login to vercel cli"
          );
        }
        if (!projectId) {
          throw new import_token_error.VercelOidcTokenError(
            "Failed to refresh OIDC token: project id not found"
          );
        }
        maybeToken = await (0, import_token_util.getVercelOidcToken)(authToken, projectId, teamId);
        if (!maybeToken) {
          throw new import_token_error.VercelOidcTokenError("Failed to refresh OIDC token");
        }
        (0, import_token_util.saveToken)(maybeToken, projectId);
      }
      process.env.VERCEL_OIDC_TOKEN = maybeToken.token;
      return;
    }
  }
});
var token6GSAFR2W = require_token();

export { token6GSAFR2W as default };

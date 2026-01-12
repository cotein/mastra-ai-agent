import { r as require_token_util } from './chunk-DVSCJECS.mjs';
import { s as __commonJS, t as require_token_error } from './index.mjs';
import '@mastra/core/evals/scoreTraces';
import '@mastra/core';
import '@mastra/core/server';
import '@mastra/core/agent';
import '@mastra/memory';
import '@ai-sdk/openai';
import '@mastra/pg';
import 'pg';
import '@mastra/core/processors';
import './tools/490e7c3c-7ec4-4c27-8c47-2a54f4f1ce1b.mjs';
import '@mastra/core/tools';
import 'zod';
import 'googleapis';
import './tools/937d1ddb-f6e7-46f2-bc37-cd9ddd4d91fe.mjs';
import './tools/093f3af4-28ba-4d34-8c10-bc08b1fbe04f.mjs';
import './tools/866236a8-5743-4a17-8f3c-fce6b7631f38.mjs';
import 'openai';
import '@mastra/core/workflows';
import './tools/ccfaa10c-8692-4519-90f2-d83a47062601.mjs';
import 'axios';
import './tools/d1c711ed-10e4-4340-9b03-eccaf9c2563f.mjs';
import 'fs/promises';
import 'https';
import 'path';
import 'http';
import 'http2';
import 'stream';
import 'crypto';
import 'fs';
import '@mastra/core/utils/zod-to-json';
import '@mastra/core/error';
import '@mastra/core/utils';
import '@mastra/core/evals';
import '@mastra/core/storage';
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
import 'buffer';
import './tools.mjs';

// ../agent-builder/dist/token-6GSAFR2W-KVDFAJ2M.js
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

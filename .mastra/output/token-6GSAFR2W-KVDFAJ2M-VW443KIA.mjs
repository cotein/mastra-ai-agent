import { r as require_token_util } from './chunk-DVSCJECS.mjs';
import { s as __commonJS, t as require_token_error } from './index.mjs';
import '@mastra/core/evals/scoreTraces';
import '@mastra/core';
import '@mastra/core/server';
import 'axios';
import '@mastra/core/agent';
import '@mastra/memory';
import '@ai-sdk/openai';
import '@mastra/pg';
import 'pg';
import '@mastra/core/processors';
import 'ai';
import './tools/b64b026b-87dd-41fb-83bc-9411d06fda0b.mjs';
import '@mastra/core/tools';
import 'zod';
import 'googleapis';
import 'chrono-node';
import 'date-fns';
import './tools/2f64e598-4a43-4716-b8fa-1f419573a61a.mjs';
import './tools/dad10bc2-dfc1-4209-af47-48e756edcbae.mjs';
import './tools/efad3dd0-fd58-417a-b6dd-834076eb3b7a.mjs';
import 'openai';
import './tools/0fc69ec8-371c-439a-a982-7d036aabd998.mjs';
import './tools/55e46205-755c-4df1-b9a5-77e6e7952234.mjs';
import '@mastra/core/workflows';
import 'fs/promises';
import 'https';
import 'path';
import 'url';
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

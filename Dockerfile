ARG NODE_VERSION=24.0.0

# --- Etapa 1: Build ---
FROM node:${NODE_VERSION}-alpine as builder
WORKDIR /app

# Solo copiamos los archivos necesarios para instalar dependencias
COPY package*.json ./
RUN npm install

# Copiamos solo el código fuente (no node_modules gracias al .dockerignore)
COPY src ./src
COPY tsconfig.json ./
COPY *.config.* ./

RUN npm run build

# --- Etapa 2: Runner ---
FROM node:${NODE_VERSION}-alpine as runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --only=production

# Copiar build de la etapa anterior
COPY --from=builder /app/.mastra ./.mastra

EXPOSE 4111

CMD ["npx", "mastra", "start"]
ARG NODE_VERSION=24.0.0

# --- Etapa 1: Build ---
FROM node:${NODE_VERSION}-alpine as builder
WORKDIR /app

# Instalamos todas las dependencias (necesarias para el build)
COPY package*.json ./
RUN npm install

# Copiamos el código y construimos
COPY . .
RUN npm run build

# --- Etapa 2: Runner ---
FROM node:${NODE_VERSION}-alpine as runner
WORKDIR /app

ENV NODE_ENV=production

# Copiamos los archivos de paquetes
COPY package*.json ./

# TIP: Instalamos dependencias incluyendo las necesarias para ejecutar el CLI de Mastra
# Si tienes problemas de módulos no encontrados, quita el --only=production
RUN npm install --only=production

# COPIA CRUCIAL: Copiamos la carpeta de salida generada por Mastra
COPY --from=builder /app/.mastra ./.mastra
# También es recomendable copiar los node_modules desde builder si tienes espacio, 
# para evitar inconsistencias, pero npm install --only=production suele bastar.

# Exponer puerto (Mastra suele usar 4111)
EXPOSE 4111

# Usamos npx para asegurar que usamos el binario local de la carpeta .mastra
CMD ["npx", "mastra", "start"]